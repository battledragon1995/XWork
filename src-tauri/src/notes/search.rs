use super::{NotesError, models::*};
/// Validates and normalizes the bounded all-token query.
pub(crate) fn tokens(query: &str) -> Result<Vec<String>, NotesError> {
    if query.chars().any(char::is_control) || query.trim().chars().count() > 128 {
        return Err(NotesError::InvalidSearch);
    }
    let result = query
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    if result.len() > 8 {
        return Err(NotesError::InvalidSearch);
    }
    Ok(result)
}
/// Removes raw HTML tags and dangerous HTML blocks from display text only.
fn plain(markdown: &str) -> String {
    let chars = markdown.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '<' {
            let tail = chars[index..].iter().collect::<String>();
            let lower = tail.to_ascii_lowercase();
            let block = [
                "script",
                "style",
                "iframe",
                "object",
                "pre",
                "div",
                "table",
                "section",
                "article",
                "p",
                "h1",
                "h2",
                "h3",
                "ul",
                "ol",
                "blockquote",
            ]
            .iter()
            .find(
                // Recognizes block tags that must not expose raw inner markup.
                |name| {
                    lower.starts_with(&format!("<{name}>"))
                        || lower.starts_with(&format!("<{name} "))
                },
            );
            if lower.starts_with("<!--") {
                index += tail.find("-->").map_or(
                    chars.len() - index,
                    // Advances past a whole HTML comment in scalar units.
                    |end| tail[..end + 3].chars().count(),
                );
                output.push(' ');
                continue;
            }
            if let Some(name) = block {
                let closing = format!("</{name}>");
                index += lower.find(&closing).map_or(
                    chars.len() - index,
                    // Counts original scalars through the ASCII closing tag.
                    |end| lower[..end + closing.len()].chars().count(),
                );
                output.push(' ');
                continue;
            }
            if chars.get(index + 1).is_some_and(
                // Treats HTML-like opening characters as markup, preserving ordinary comparisons.
                |next| next.is_ascii_alphabetic() || *next == '/' || *next == '!',
            ) {
                let mut quote = None;
                index += 1;
                while index < chars.len() {
                    let ch = chars[index];
                    index += 1;
                    if Some(ch) == quote {
                        quote = None;
                    } else if quote.is_none() && (ch == '\'' || ch == '"') {
                        quote = Some(ch);
                    } else if quote.is_none() && ch == '>' {
                        break;
                    }
                }
                output.push(' ');
                continue;
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}
/// Maps lowercase-expanded matches back to sorted display-scalar ranges.
pub(crate) fn highlights(text: &str, tokens: &[String]) -> Vec<NoteTextRangeDto> {
    let mut normalized = Vec::new();
    let mut origins = Vec::new();
    for (index, ch) in text.chars().enumerate() {
        for lower in ch.to_lowercase() {
            normalized.push(lower);
            origins.push(index as u32);
        }
    }
    let mut matches = Vec::<(u32, u32)>::new();
    for token in tokens {
        let needle = token.chars().collect::<Vec<_>>();
        if needle.is_empty() {
            continue;
        }
        for (index, window) in normalized.windows(needle.len()).enumerate() {
            if window == needle {
                matches.push((origins[index], origins[index + needle.len() - 1] + 1));
            }
        }
    }
    matches.sort_unstable();
    let mut merged = Vec::<NoteTextRangeDto>::new();
    for (start, end) in matches {
        if let Some(last) = merged.last_mut()
            && start <= last.end_scalar
        {
            last.end_scalar = last.end_scalar.max(end);
            continue;
        }
        merged.push(NoteTextRangeDto {
            start_scalar: start,
            end_scalar: end,
        });
    }
    merged
}
/// Produces a maximum 160-scalar snippet around the first body match.
pub(crate) fn snippet(markdown: &str, tokens: &[String]) -> String {
    let text = plain(markdown);
    let chars = text.chars().collect::<Vec<_>>();
    if chars.len() <= 160 {
        return text;
    }
    let start = highlights(&text, tokens).first().map_or(
        0,
        // Leaves a small context prefix before a distant match.
        |range| (range.start_scalar as usize).saturating_sub(32),
    );
    let start = start.min(chars.len().saturating_sub(158));
    let prefix = usize::from(start > 0);
    let end = (start + 160 - prefix - 1).min(chars.len());
    let mut result = String::new();
    if start > 0 {
        result.push('…');
    }
    result.extend(&chars[start..end]);
    if end < chars.len() {
        result.push('…');
    }
    result
}
/// Builds the public summary without modifying stored Markdown.
pub(crate) fn summary(note: NoteDto, tokens: &[String]) -> NoteSummaryDto {
    let snippet = snippet(&note.content_markdown, tokens);
    NoteSummaryDto {
        title_highlights: highlights(note.title.as_deref().unwrap_or(""), tokens),
        snippet_highlights: highlights(&snippet, tokens),
        snippet,
        id: note.id,
        title: note.title,
        project_id: note.project_id,
        is_pinned: note.is_pinned,
        status: note.status,
        created_at_ms: note.created_at_ms,
        updated_at_ms: note.updated_at_ms,
        archived_at_ms: note.archived_at_ms,
        trashed_at_ms: note.trashed_at_ms,
        revision: note.revision,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Covers Unicode expansion offsets and raw HTML exclusion.
    #[test]
    fn safe_snippets_and_scalar_ranges() {
        assert_eq!(
            highlights("😀İx", &["i\u{307}".into()]),
            vec![NoteTextRangeDto {
                start_scalar: 1,
                end_scalar: 2
            }]
        );
        assert_eq!(
            snippet(
                "Hello <script>secret</script> <b>world</b><!-- hidden -->",
                &[]
            ),
            "Hello world"
        );
        let text = format!("{} needle {}", "x".repeat(200), "z".repeat(200));
        let shown = snippet(&text, &["needle".into()]);
        assert!(shown.contains("needle"));
        assert!(shown.chars().count() <= 160);
        assert!(tokens("one\ntwo").is_err());
        assert!(tokens("a b c d e f g h i").is_err());
    }
}
