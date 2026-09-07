import type { FileWatchModeDto, LineEndingDto, TextEncodingDto } from "@/bindings/files/files";

/** Status-bar label stating the viewer never writes to disk. */
export const READ_ONLY_STATUS_LABEL = "Read-only · edit in your editor";
/** Body copy shown when a readable text file contains no bytes. */
export const EMPTY_FILE_MESSAGE = "This file is empty.";
/** Note shown when the backend watches this handle by polling instead of native hints. */
export const POLLING_FALLBACK_NOTE = "Change detection is delayed for this file.";
/** Note shown for Markdown so the missing editor reads as deferred, not broken. */
export const MARKDOWN_DEFERRAL_NOTE = "Editing and preview arrive with the Markdown editor.";
/** Note shown when the file exceeds the syntax threshold and highlighting was skipped. */
export const SYNTAX_LIMIT_NOTE = "Syntax highlighting is off for large files.";
/** Note shown when a language pack failed to load and plain text is displayed instead. */
export const SYNTAX_UNAVAILABLE_NOTE = "Syntax highlighting is unavailable for this file.";

/** Bytes in one kibibyte. */
const KIBIBYTE = 1024n;
/** Bytes in one mebibyte. */
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

/**
 * Divide with one fractional digit using only `bigint` arithmetic. Backend byte counts can
 * exceed `Number.MAX_SAFE_INTEGER`, and converting them to a double would silently move the
 * displayed figure, so the rounding happens on exact integers instead.
 */
function scaleBytes(bytes: bigint, unit: bigint, suffix: string): string {
  const tenths = (bytes * 10n + unit / 2n) / unit;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return fraction === 0n ? `${whole} ${suffix}` : `${whole}.${fraction} ${suffix}`;
}

/** Format one backend byte count without ever coercing it to an unsafe JavaScript number. */
export function formatByteSize(bytes: bigint): string {
  if (bytes < KIBIBYTE) return `${bytes} B`;
  if (bytes < MEBIBYTE) return scaleBytes(bytes, KIBIBYTE, "KB");
  return scaleBytes(bytes, MEBIBYTE, "MB");
}

/** Format the backend line count, keeping the singular form for exactly one line. */
export function formatLineCount(lineCount: number): string {
  return lineCount === 1 ? "1 line" : `${lineCount} lines`;
}

/** Name the encoding, distinguishing a byte-order mark the backend detected. */
export function formatEncoding(_encoding: TextEncodingDto, hasUtf8Bom: boolean): string {
  // Files returns lossless UTF-8 only, so the mark is the sole distinguishing fact today.
  return hasUtf8Bom ? "UTF-8 with BOM" : "UTF-8";
}

/** Name the line-ending style, or report nothing for a file with no line break at all. */
export function formatLineEnding(lineEnding: LineEndingDto): string | null {
  switch (lineEnding) {
    case "lf":
      return "LF";
    case "crlf":
      return "CRLF";
    case "mixed":
      return "Mixed";
    // A file without a single line break has no meaningful style to report.
    case "none":
      return null;
  }
}

/** Explain a delayed watch mode; native watching needs no note. */
export function watchModeNote(watchMode: FileWatchModeDto): string | null {
  return watchMode === "pollingFallback" ? POLLING_FALLBACK_NOTE : null;
}
