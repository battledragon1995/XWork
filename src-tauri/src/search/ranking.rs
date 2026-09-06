use super::{SearchTextRangeDto, UnifiedSearchError};

const TITLE_LIMIT: usize = 256;
const CONTEXT_LIMIT: usize = 160;

/// Holds normalized display text and scalar-origin mappings.
struct NormalizedText {
    display: String,
    normalized: Vec<char>,
    origins: Vec<usize>,
}

/// Holds one successful document match.
pub(super) struct RankedText {
    pub title: String,
    pub context: Option<String>,
    pub title_highlights: Vec<SearchTextRangeDto>,
    pub context_highlights: Vec<SearchTextRangeDto>,
    pub score: u32,
}

/// Trims and validates caller input without changing internal whitespace.
pub(super) fn validate_query(query: &str) -> Result<String, UnifiedSearchError> {
    let trimmed = query.trim();
    if trimmed.chars().count() > 128 || trimmed.chars().any(char::is_control) {
        return Err(UnifiedSearchError::InvalidQuery);
    }
    Ok(trimmed.to_owned())
}

/// Validates one canonical lowercase hyphenated UUID.
pub(super) fn validate_context_id(value: Option<&str>) -> Result<(), UnifiedSearchError> {
    let Some(value) = value else {
        return Ok(());
    };
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| UnifiedSearchError::InvalidContextProjectId)?;
    if parsed.hyphenated().to_string() != value {
        return Err(UnifiedSearchError::InvalidContextProjectId);
    }
    Ok(())
}

/// Collapses Unicode whitespace and truncates text with one scalar ellipsis.
fn display_text(value: &str, limit: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= limit {
        return collapsed;
    }
    collapsed
        .chars()
        .take(limit.saturating_sub(1))
        .chain(std::iter::once('…'))
        .collect()
}

/// Lowercases text while retaining each normalized scalar's display origin.
fn normalize(value: &str, limit: usize) -> NormalizedText {
    let display = display_text(value, limit);
    let mut normalized = Vec::new();
    let mut origins = Vec::new();
    for (origin, scalar) in display.chars().enumerate() {
        for lowered in scalar.to_lowercase() {
            normalized.push(lowered);
            origins.push(origin);
        }
    }
    NormalizedText {
        display,
        normalized,
        origins,
    }
}

/// Finds every occurrence of a normalized token in display text.
fn occurrences(text: &NormalizedText, token: &[char]) -> Vec<SearchTextRangeDto> {
    if token.is_empty() || token.len() > text.normalized.len() {
        return Vec::new();
    }
    text.normalized
        .windows(token.len())
        .enumerate()
        .filter(|(_, window)| *window == token)
        .map(|(start, _)| SearchTextRangeDto {
            start_scalar: u32::try_from(text.origins[start]).unwrap_or(u32::MAX),
            end_scalar: u32::try_from(text.origins[start + token.len() - 1] + 1)
                .unwrap_or(u32::MAX),
        })
        .collect()
}

/// Merges overlapping or touching scalar ranges into stable display order.
fn merge_ranges(mut ranges: Vec<SearchTextRangeDto>) -> Vec<SearchTextRangeDto> {
    ranges.sort_by_key(|range| (range.start_scalar, range.end_scalar));
    let mut merged: Vec<SearchTextRangeDto> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range.start_scalar <= last.end_scalar
        {
            last.end_scalar = last.end_scalar.max(range.end_scalar);
        } else {
            merged.push(range);
        }
    }
    merged
}

/// Scores and highlights a document when every query token matches.
pub(super) fn rank_text(
    query: &str,
    title: &str,
    context: Option<&str>,
    keywords: &[String],
) -> Option<RankedText> {
    let title = normalize(title, TITLE_LIMIT);
    let context = context.map(|value| normalize(value, CONTEXT_LIMIT));
    let query_normalized: String = query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .flat_map(char::to_lowercase)
        .collect();
    let query_tokens: Vec<Vec<char>> = query_normalized
        .split_whitespace()
        .map(|token| token.chars().collect())
        .collect();
    let title_tokens: Vec<Vec<char>> = title
        .normalized
        .split(|scalar| scalar.is_whitespace())
        .map(<[char]>::to_vec)
        .collect();
    let context_tokens: Vec<Vec<char>> = context
        .as_ref()
        .map(|value| {
            value
                .normalized
                .split(|scalar| scalar.is_whitespace())
                .map(<[char]>::to_vec)
                .collect()
        })
        .unwrap_or_default();
    let normalized_keywords: String = keywords
        .join(" ")
        .chars()
        .flat_map(char::to_lowercase)
        .collect();
    let keyword_tokens: Vec<Vec<char>> = normalized_keywords
        .split_whitespace()
        .map(|token| token.chars().collect())
        .collect();

    let mut score = 0;
    let mut title_ranges = Vec::new();
    let mut context_ranges = Vec::new();
    for token in &query_tokens {
        let title_occurrences = occurrences(&title, token);
        let context_occurrences = context
            .as_ref()
            .map(|value| occurrences(value, token))
            .unwrap_or_default();
        let token_score = if title_tokens.iter().any(|word| word == token) {
            120
        } else if title_tokens.iter().any(|word| word.starts_with(token)) {
            100
        } else if !title_occurrences.is_empty() {
            80
        } else if context_tokens.iter().any(|word| word.starts_with(token)) {
            50
        } else if !context_occurrences.is_empty() {
            30
        } else if keyword_tokens.iter().any(|word| word.starts_with(token)) {
            20
        } else if keyword_tokens
            .iter()
            .any(|word| word.windows(token.len()).any(|part| part == token))
        {
            10
        } else {
            return None;
        };
        score += token_score;
        title_ranges.extend(title_occurrences);
        context_ranges.extend(context_occurrences);
    }

    let normalized_title: String = title.normalized.iter().collect();
    if normalized_title == query_normalized {
        score += 1000;
    } else if normalized_title.starts_with(&query_normalized) {
        score += 500;
    }
    Some(RankedText {
        title: title.display,
        context: context.as_ref().map(|value| value.display.clone()),
        title_highlights: merge_ranges(title_ranges),
        context_highlights: merge_ranges(context_ranges),
        score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies query validation counts Unicode scalars after trimming.
    #[test]
    fn query_validation_uses_trimmed_unicode_scalars() {
        assert_eq!(validate_query("  Việt  ").unwrap(), "Việt");
        assert!(validate_query(&"🙂".repeat(128)).is_ok());
        assert_eq!(
            validate_query(&"🙂".repeat(129)),
            Err(UnifiedSearchError::InvalidQuery)
        );
        assert_eq!(
            validate_query("ok\nno"),
            Err(UnifiedSearchError::InvalidQuery)
        );
    }

    /// Verifies canonical context IDs are lowercase and hyphenated.
    #[test]
    fn context_validation_requires_canonical_uuid() {
        let canonical = "00000000-0000-4000-8000-000000000001";
        assert!(validate_context_id(Some(canonical)).is_ok());
        assert_eq!(
            validate_context_id(Some("00000000000040008000000000000001")),
            Err(UnifiedSearchError::InvalidContextProjectId)
        );
    }

    /// Verifies scoring priority and keyword-only highlight behavior.
    #[test]
    fn ranking_scores_title_before_context_and_keywords() {
        let exact = rank_text("alpha", "Alpha", Some("elsewhere"), &[]).unwrap();
        let context = rank_text("alpha", "Other", Some("Alpha place"), &[]).unwrap();
        let keyword = rank_text("alpha", "Other", None, &["alpha".into()]).unwrap();
        assert!(exact.score > context.score && context.score > keyword.score);
        assert!(keyword.title_highlights.is_empty());
    }

    /// Verifies lowercase expansion and emoji preserve display scalar ranges.
    #[test]
    fn highlights_map_normalized_text_to_original_scalars() {
        let ranked = rank_text("i", "🙂İtem", None, &[]).unwrap();
        assert_eq!(
            ranked.title_highlights,
            vec![SearchTextRangeDto {
                start_scalar: 1,
                end_scalar: 2
            }]
        );
    }

    /// Verifies display projection collapses whitespace and truncates with ellipsis.
    #[test]
    fn display_projection_collapses_and_truncates() {
        let ranked = rank_text(
            "name",
            &format!("Name  {}", "x".repeat(300)),
            Some("a\n b"),
            &[],
        )
        .unwrap();
        assert_eq!(ranked.title.chars().count(), 256);
        assert!(ranked.title.ends_with('…'));
        assert_eq!(ranked.context.as_deref(), Some("a b"));
    }

    /// Verifies every token must match and accents are not folded away.
    #[test]
    fn matching_requires_all_tokens_without_accent_folding() {
        assert!(rank_text("build running", "Build Session", Some("Running"), &[]).is_some());
        assert!(rank_text("build missing", "Build Session", Some("Running"), &[]).is_none());
        assert!(rank_text("viet", "Việt", None, &[]).is_none());
    }

    /// Verifies normalized whole-query bonuses collapse internal whitespace.
    #[test]
    fn exact_bonus_collapses_query_whitespace() {
        let single = rank_text("open home", "Open Home", None, &[]).unwrap();
        let repeated = rank_text("open   home", "Open Home", None, &[]).unwrap();
        assert_eq!(single.score, repeated.score);
    }

    /// Verifies every documented field tier receives its exact score.
    #[test]
    fn scoring_uses_the_documented_match_tiers() {
        assert_eq!(rank_text("alpha", "Alpha", None, &[]).unwrap().score, 1120);
        assert_eq!(rank_text("alp", "Alpha", None, &[]).unwrap().score, 600);
        assert_eq!(rank_text("pha", "Alpha", None, &[]).unwrap().score, 80);
        assert_eq!(
            rank_text("alp", "Other", Some("Alpha"), &[]).unwrap().score,
            50
        );
        assert_eq!(
            rank_text("pha", "Other", Some("Alpha"), &[]).unwrap().score,
            30
        );
        assert_eq!(
            rank_text("alp", "Other", None, &["alpha".into()])
                .unwrap()
                .score,
            20
        );
        assert_eq!(
            rank_text("pha", "Other", None, &["alpha".into()])
                .unwrap()
                .score,
            10
        );
    }

    /// Verifies touching and overlapping token highlights merge within scalar bounds.
    #[test]
    fn highlights_merge_touching_and_overlapping_matches() {
        let ranked = rank_text("foo oob", "foobar", None, &[]).unwrap();
        assert_eq!(
            ranked.title_highlights,
            vec![SearchTextRangeDto {
                start_scalar: 0,
                end_scalar: 4,
            }]
        );
        assert!(
            ranked
                .title_highlights
                .iter()
                .all(|range| range.start_scalar < range.end_scalar && range.end_scalar <= 6)
        );
    }
}
