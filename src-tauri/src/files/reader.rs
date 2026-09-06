use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    error::FilesError,
    models::{
        FileContentDto, FileDiskVersionDto, LineEndingDto, MAX_VIEWER_BYTES, TextEncodingDto,
        TextFileDto, TextFileModeDto,
    },
    path_policy::{FilePathPolicy, ValidatedProjectPath},
};

/// Identifies a file independently of its path when the platform exposes an identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlatformFileIdentity {
    #[cfg(windows)]
    Windows {
        volume_serial_number: u64,
        file_id: u128,
    },
    #[cfg(unix)]
    Unix { device: u64, inode: u64 },
}

/// Captures every disk fact needed to reject mixed-version reads.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiskFingerprint {
    pub file_identity: Option<PlatformFileIdentity>,
    pub byte_size: u64,
    pub modified_at: Option<SystemTime>,
    pub content_digest: blake3::Hash,
}

/// Carries one consistent classified snapshot and its private fingerprint.
#[derive(Clone, Debug)]
pub(crate) struct DiskFileSnapshot {
    pub content: FileContentDto,
    pub disk: FileDiskVersionDto,
    pub fingerprint: DiskFingerprint,
}

/// Reads validated files with a bounded buffer and one consistency retry.
#[derive(Clone, Copy, Default)]
pub(crate) struct FileReader;

impl FileReader {
    /// Reads one exact disk version or rejects a second concurrent change.
    pub(crate) fn read(
        &self,
        policy: FilePathPolicy,
        target: &ValidatedProjectPath,
        observed_at_ms: i64,
    ) -> Result<DiskFileSnapshot, FilesError> {
        for attempt in 0..2 {
            match read_once(policy, target, observed_at_ms) {
                Ok(Some(snapshot)) => return Ok(snapshot),
                Ok(None) if attempt == 0 => continue,
                Ok(None) => return Err(FilesError::FileChangedDuringRead),
                Err(error) => return Err(error),
            }
        }
        Err(FilesError::FileChangedDuringRead)
    }
}

/// Reads and compares before/after metadata so a returned buffer has one identity.
fn read_once(
    policy: FilePathPolicy,
    target: &ValidatedProjectPath,
    observed_at_ms: i64,
) -> Result<Option<DiskFileSnapshot>, FilesError> {
    policy.revalidate(target)?;
    let mut file = File::open(&target.absolute_path).map_err(map_read_error)?;
    let before = file.metadata().map_err(map_read_error)?;
    if !before.is_file() {
        return Err(FilesError::NotRegularFile {
            relative_path: target.relative_path.clone(),
        });
    }
    let before_identity = file_identity(&file, &before);
    let byte_size = before.len();
    let mime_type = mime_type(&target.absolute_path, byte_size <= MAX_VIEWER_BYTES);
    let (content, digest) = if byte_size > MAX_VIEWER_BYTES {
        let digest = hash_stream(&mut file)?;
        (
            FileContentDto::TooLarge {
                byte_size,
                limit_bytes: MAX_VIEWER_BYTES,
                mime_type: mime_type.clone(),
            },
            digest,
        )
    } else {
        let mut bytes = Vec::with_capacity((byte_size as usize).saturating_add(1));
        (&mut file)
            .take(MAX_VIEWER_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(map_read_error)?;
        if bytes.len() as u64 > MAX_VIEWER_BYTES {
            return Ok(None);
        }
        let digest = blake3::hash(&bytes);
        let content = classify_content(&target.absolute_path, bytes, mime_type.clone())?;
        (content, digest)
    };
    policy.revalidate(target)?;
    let after_file = match File::open(&target.absolute_path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let after = after_file.metadata().map_err(map_read_error)?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || before_identity != file_identity(&after_file, &after)
    {
        return Ok(None);
    }
    let fingerprint = DiskFingerprint {
        file_identity: before_identity,
        byte_size: after.len(),
        modified_at: after.modified().ok(),
        content_digest: digest,
    };
    let disk_revision = fingerprint_token(&fingerprint);
    Ok(Some(DiskFileSnapshot {
        content,
        disk: FileDiskVersionDto {
            disk_revision,
            observed_at_ms,
            modified_at_ms: system_time_ms(fingerprint.modified_at),
            byte_size: fingerprint.byte_size,
            mime_type,
        },
        fingerprint,
    }))
}

/// Streams an oversized file into a fixed-size hashing buffer.
fn hash_stream(file: &mut File) -> Result<blake3::Hash, FilesError> {
    file.seek(SeekFrom::Start(0)).map_err(map_read_error)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(map_read_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize())
}

/// Classifies bounded bytes without trusting their extension.
fn classify_content(
    path: &Path,
    bytes: Vec<u8>,
    mime_type: String,
) -> Result<FileContentDto, FilesError> {
    let byte_size = bytes.len() as u64;
    if bytes.contains(&0) {
        return Ok(FileContentDto::Binary {
            byte_size,
            mime_type,
        });
    }
    let has_utf8_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let text_bytes = if has_utf8_bom { &bytes[3..] } else { &bytes };
    let text = match std::str::from_utf8(text_bytes) {
        Ok(value) => value.to_owned(),
        Err(_) => {
            return Ok(FileContentDto::Binary {
                byte_size,
                mime_type,
            });
        }
    };
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_lowercase);
    let mode = if matches!(extension.as_deref(), Some("md" | "markdown")) {
        TextFileModeDto::Markdown
    } else {
        TextFileModeDto::SourceReadOnly
    };
    let (line_count, line_ending) = line_facts(&text)?;
    Ok(FileContentDto::Text {
        file: TextFileDto {
            text,
            byte_size,
            line_count,
            mime_type,
            syntax_hint: extension,
            encoding: TextEncodingDto::Utf8,
            has_utf8_bom,
            line_ending,
            mode,
        },
    })
}

/// Counts logical breaks and classifies CRLF versus bare LF bytes.
fn line_facts(text: &str) -> Result<(u32, LineEndingDto), FilesError> {
    if text.is_empty() {
        return Ok((0, LineEndingDto::None));
    }
    let bytes = text.as_bytes();
    let mut lf = 0_u32;
    let mut crlf = 0_u32;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            lf = lf.checked_add(1).ok_or(FilesError::FileReadFailed)?;
            if index > 0 && bytes[index - 1] == b'\r' {
                crlf = crlf.checked_add(1).ok_or(FilesError::FileReadFailed)?;
            }
        }
    }
    let bare_lf = lf.saturating_sub(crlf);
    let ending = match (crlf > 0, bare_lf > 0) {
        (false, false) => LineEndingDto::None,
        (false, true) => LineEndingDto::Lf,
        (true, false) => LineEndingDto::Crlf,
        (true, true) => LineEndingDto::Mixed,
    };
    Ok((lf.checked_add(1).ok_or(FilesError::FileReadFailed)?, ending))
}

/// Chooses a safe extension hint while preserving text fallbacks.
fn mime_type(path: &Path, may_be_text: bool) -> String {
    mime_guess::from_path(path)
        .first_raw()
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if may_be_text {
                "text/plain".to_owned()
            } else {
                "application/octet-stream".to_owned()
            }
        })
}

/// Encodes a private fingerprint into an opaque public token.
fn fingerprint_token(fingerprint: &DiskFingerprint) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&fingerprint.byte_size.to_le_bytes());
    if let Some(modified) = system_time_ms(fingerprint.modified_at) {
        hasher.update(&modified.to_le_bytes());
    }
    hasher.update(fingerprint.content_digest.as_bytes());
    hasher.finalize().to_hex().to_string()
}

/// Converts a nonnegative filesystem timestamp into checked epoch milliseconds.
fn system_time_ms(value: Option<SystemTime>) -> Option<i64> {
    let duration = value?.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

/// Maps file I/O failures without including native details.
fn map_read_error(error: std::io::Error) -> FilesError {
    match error.kind() {
        std::io::ErrorKind::NotFound => FilesError::EntryNotFound {
            relative_path: String::new(),
        },
        _ => FilesError::FileReadFailed,
    }
}

/// Reads the strongest stable file identity available on the current platform.
fn file_identity(file: &File, metadata: &std::fs::Metadata) -> Option<PlatformFileIdentity> {
    #[cfg(windows)]
    {
        use std::{mem::size_of, os::windows::io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
        };
        let mut info = FILE_ID_INFO::default();
        // The output buffer has the exact Win32 type and remains live for the call.
        let succeeded = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                (&mut info as *mut FILE_ID_INFO).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            )
        };
        let _ = metadata;
        (succeeded != 0).then(|| PlatformFileIdentity::Windows {
            volume_serial_number: info.VolumeSerialNumber,
            file_id: u128::from_le_bytes(info.FileId.Identifier),
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = file;
        Some(PlatformFileIdentity::Unix {
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (file, metadata);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::path_policy::FilePathIntent;

    /// Reads one temporary file through the same validated path contract as production.
    fn read_fixture(name: &str, bytes: &[u8]) -> DiskFileSnapshot {
        let fixture = tempfile::tempdir().expect("fixture should be created");
        std::fs::write(fixture.path().join(name), bytes).expect("fixture should be written");
        let root = std::fs::canonicalize(fixture.path()).expect("root should canonicalize");
        let policy = FilePathPolicy;
        let target = policy
            .resolve(&root, name, None, FilePathIntent::OpenVisibleFile)
            .expect("path should validate");
        FileReader
            .read(policy, &target, 7)
            .expect("file should read")
    }

    /// Verifies BOM, line endings, binary detection, and Markdown mode.
    #[test]
    fn classification_is_lossless_and_content_driven() {
        let snapshot = read_fixture("README.MD", b"\xEF\xBB\xBFa\r\nb\nc");
        let FileContentDto::Text { file } = snapshot.content else {
            panic!("text expected")
        };
        assert_eq!(file.text, "a\r\nb\nc");
        assert_eq!(file.byte_size, 9);
        assert_eq!(file.line_count, 3);
        assert_eq!(file.line_ending, LineEndingDto::Mixed);
        assert_eq!(file.mode, TextFileModeDto::Markdown);
        assert!(file.has_utf8_bom);
        assert!(matches!(
            read_fixture("data.txt", b"a\0b").content,
            FileContentDto::Binary { .. }
        ));
        assert!(matches!(
            read_fixture("bad.txt", &[0xff]).content,
            FileContentDto::Binary { .. }
        ));
    }

    /// Verifies the exact viewer boundary remains accepted.
    #[test]
    fn viewer_size_boundary_is_exact() {
        let exact = vec![b'x'; MAX_VIEWER_BYTES as usize];
        assert!(matches!(
            read_fixture("exact.txt", &exact).content,
            FileContentDto::Text { .. }
        ));
        let over = vec![b'x'; MAX_VIEWER_BYTES as usize + 1];
        assert!(matches!(
            read_fixture("over.txt", &over).content,
            FileContentDto::TooLarge { .. }
        ));
    }
}
