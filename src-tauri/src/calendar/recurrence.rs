use super::models::*;
use chrono::{Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::collections::BTreeSet;

pub(crate) struct NormalizedEvent {
    pub input: EventInputDto,
    pub time: EventTimeDto,
    pub is_all_day: bool,
    pub start_local: String,
    pub end_local: String,
    pub time_zone_id: String,
    pub start_at_ms: Option<i64>,
    pub end_at_ms: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub search_text: String,
}

pub(crate) struct ValidatedRange {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub timezone: Tz,
    pub from_ms: i64,
    pub to_ms: i64,
}

pub(crate) struct ResolvedOccurrence {
    pub dto: CalendarOccurrenceDto,
    pub starts_at_ms: i64,
}

/// Accepts only canonical lowercase UUID representations.
pub(crate) fn validate_id(value: &str, error: CalendarError) -> Result<(), CalendarError> {
    match uuid::Uuid::parse_str(value) {
        Ok(id) if id.to_string() == value => Ok(()),
        _ => Err(error),
    }
}

/// Parses an opaque positive decimal revision without alternate encodings.
pub(crate) fn validate_revision(value: &str) -> Result<i64, CalendarError> {
    match value.parse::<i64>() {
        Ok(value_parsed) if value_parsed > 0 && value_parsed.to_string() == value => {
            Ok(value_parsed)
        }
        _ => Err(CalendarError::InvalidRevision),
    }
}

/// Parses the exact supported floating-date representation.
pub(crate) fn parse_date(value: &str) -> Result<NaiveDate, CalendarError> {
    let date =
        // Redacts parser details to the matching domain error.
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| CalendarError::InvalidDate)?;
    if date.format("%Y-%m-%d").to_string() != value {
        return Err(CalendarError::InvalidDate);
    }
    if !(1900..=9999).contains(&date.year()) {
        return Err(CalendarError::DateOutOfRange);
    }
    Ok(date)
}

/// Parses minute precision without accepting seconds or UTC offsets.
fn parse_local(value: &str) -> Result<NaiveDateTime, CalendarError> {
    let local = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")
        // Redacts parser details to the matching domain error.
        .map_err(|_| CalendarError::InvalidLocalDateTime)?;
    if local.format("%Y-%m-%dT%H:%M").to_string() != value {
        return Err(CalendarError::InvalidLocalDateTime);
    }
    if !(1900..=9999).contains(&local.year()) {
        return Err(CalendarError::DateOutOfRange);
    }
    Ok(local)
}

/// Selects the earlier UTC branch and skips nonexistent local times.
fn resolve_local(local: NaiveDateTime, timezone: Tz) -> Option<i64> {
    match timezone.from_local_datetime(&local) {
        LocalResult::None => None,
        LocalResult::Single(value) => Some(value.timestamp_millis()),
        LocalResult::Ambiguous(a, b) => Some(a.timestamp_millis().min(b.timestamp_millis())),
    }
}

/// Resolves midnight, moving past a midnight gap with second precision.
pub(crate) fn first_instant(date: NaiveDate, timezone: Tz) -> Option<i64> {
    let midnight = date.and_hms_opt(0, 0, 0)?;
    if let Some(instant) = resolve_local(midnight, timezone) {
        return Some(instant);
    }
    for minute in 1..=1440 {
        let local = midnight.checked_add_signed(Duration::minutes(minute))?;
        if resolve_local(local, timezone).is_some() {
            for second in 0..=60 {
                let candidate = local.checked_sub_signed(Duration::seconds(60 - second))?;
                if candidate.date() == date
                    && let Some(instant) = resolve_local(candidate, timezone)
                {
                    return Some(instant);
                }
            }
        }
    }
    None
}

/// Maps a skipped range boundary to the next representable calendar day.
fn range_boundary(mut date: NaiveDate, timezone: Tz) -> Result<i64, CalendarError> {
    for _ in 0..3 {
        if let Some(instant) = first_instant(date, timezone) {
            return Ok(instant);
        }
        date = date.succ_opt().ok_or(CalendarError::DateOutOfRange)?;
    }
    Err(CalendarError::DateOutOfRange)
}

/// Validates the bounded viewer range and its optional project link.
pub(crate) fn normalize_range(
    input: &CalendarRangeInputDto,
) -> Result<ValidatedRange, CalendarError> {
    let start_date = parse_date(&input.start_date)?;
    let end_date = parse_date(&input.end_date_exclusive)?;
    let days = (end_date - start_date).num_days();
    if !(1..=62).contains(&days) {
        return Err(CalendarError::InvalidRange);
    }
    let timezone = input
        .viewer_time_zone_id
        .parse::<Tz>()
        // Redacts parser details to the matching domain error.
        .map_err(|_| CalendarError::InvalidTimeZone)?;
    if let Some(id) = &input.project_id {
        validate_id(id, CalendarError::InvalidProjectId)?;
    }
    Ok(ValidatedRange {
        start_date,
        end_date,
        timezone,
        from_ms: range_boundary(start_date, timezone)?,
        to_ms: range_boundary(end_date, timezone)?,
    })
}

/// Returns a stable Monday-first weekday index.
fn weekday_number(day: &CalendarWeekdayDto) -> usize {
    match day {
        CalendarWeekdayDto::Monday => 0,
        CalendarWeekdayDto::Tuesday => 1,
        CalendarWeekdayDto::Wednesday => 2,
        CalendarWeekdayDto::Thursday => 3,
        CalendarWeekdayDto::Friday => 4,
        CalendarWeekdayDto::Saturday => 5,
        CalendarWeekdayDto::Sunday => 6,
    }
}

/// Borrows the common termination rule of a recurring definition.
fn recurrence_end(value: &EventRecurrenceDto) -> Option<&EventRecurrenceEndDto> {
    match value {
        EventRecurrenceDto::None => None,
        EventRecurrenceDto::Daily { end }
        | EventRecurrenceDto::Weekly { end, .. }
        | EventRecurrenceDto::Monthly { end }
        | EventRecurrenceDto::Yearly { end } => Some(end),
    }
}

/// Canonicalizes the supported recurrence subset and validates its base date.
fn canonical_recurrence(
    value: &mut EventRecurrenceDto,
    start: NaiveDate,
) -> Result<Option<String>, CalendarError> {
    if let EventRecurrenceDto::Weekly { weekdays, .. } = value {
        if weekdays.is_empty() || weekdays.len() > 7 {
            return Err(CalendarError::InvalidRecurrence);
        }
        weekdays.sort_by_key(weekday_number);
        // Checks each value against the domain invariant.
        if weekdays.windows(2).any(|pair| pair[0] == pair[1])
            || !weekdays
                .iter()
                // Checks each value against the domain invariant.
                .any(|day| weekday_number(day) == start.weekday().num_days_from_monday() as usize)
        {
            return Err(CalendarError::InvalidRecurrence);
        }
    }
    let frequency = match value {
        EventRecurrenceDto::None => return Ok(None),
        EventRecurrenceDto::Daily { .. } => "DAILY",
        EventRecurrenceDto::Weekly { .. } => "WEEKLY",
        EventRecurrenceDto::Monthly { .. } => "MONTHLY",
        EventRecurrenceDto::Yearly { .. } => "YEARLY",
    };
    let mut rule = format!("FREQ={frequency};INTERVAL=1");
    if let EventRecurrenceDto::Weekly { weekdays, .. } = value {
        let days: Vec<_> = weekdays
            .iter()
            // Projects each value into the normalized representation.
            .map(|day| ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][weekday_number(day)])
            .collect();
        rule.push_str(&format!(";BYDAY={}", days.join(",")));
    }
    match recurrence_end(value).expect("recurring variant has an end") {
        EventRecurrenceEndDto::Never => {}
        EventRecurrenceEndDto::AfterCount { count } if (1..=10000).contains(count) => {
            rule.push_str(&format!(";COUNT={count}"))
        }
        EventRecurrenceEndDto::OnDate { date } => {
            // Redacts parser details to the matching domain error.
            let end = parse_date(date).map_err(|_| CalendarError::InvalidRecurrenceEnd)?;
            if end < start {
                return Err(CalendarError::InvalidRecurrenceEnd);
            }
            rule.push_str(&format!(";UNTIL={}T235959Z", end.format("%Y%m%d")));
        }
        _ => return Err(CalendarError::InvalidRecurrenceEnd),
    }
    Ok(Some(rule))
}

/// Decodes only the canonical persisted subset, rejecting unknown clauses.
pub(crate) fn decode_recurrence(rule: Option<&str>) -> Result<EventRecurrenceDto, CalendarError> {
    let Some(rule) = rule else {
        return Ok(EventRecurrenceDto::None);
    };
    let mut parts = rule.split(';');
    let frequency = parts.next().ok_or(CalendarError::CorruptStoredData)?;
    if parts.next() != Some("INTERVAL=1") {
        return Err(CalendarError::CorruptStoredData);
    }
    let mut weekdays = Vec::new();
    let mut end = EventRecurrenceEndDto::Never;
    let mut ended = false;
    for part in parts {
        if let Some(days) = part.strip_prefix("BYDAY=") {
            if frequency != "FREQ=WEEKLY" || !weekdays.is_empty() || ended {
                return Err(CalendarError::CorruptStoredData);
            }
            for day in days.split(',') {
                weekdays.push(match day {
                    "MO" => CalendarWeekdayDto::Monday,
                    "TU" => CalendarWeekdayDto::Tuesday,
                    "WE" => CalendarWeekdayDto::Wednesday,
                    "TH" => CalendarWeekdayDto::Thursday,
                    "FR" => CalendarWeekdayDto::Friday,
                    "SA" => CalendarWeekdayDto::Saturday,
                    "SU" => CalendarWeekdayDto::Sunday,
                    _ => return Err(CalendarError::CorruptStoredData),
                });
            }
        } else if let Some(count) = part.strip_prefix("COUNT=") {
            if ended {
                return Err(CalendarError::CorruptStoredData);
            }
            end = EventRecurrenceEndDto::AfterCount {
                count: count
                    .parse()
                    // Redacts parser details to the matching domain error.
                    .map_err(|_| CalendarError::CorruptStoredData)?,
            };
            ended = true;
        } else if let Some(until) = part.strip_prefix("UNTIL=") {
            if ended {
                return Err(CalendarError::CorruptStoredData);
            }
            let date = NaiveDateTime::parse_from_str(until, "%Y%m%dT%H%M%SZ")
                // Redacts parser details to the matching domain error.
                .map_err(|_| CalendarError::CorruptStoredData)?;
            if date.time().hour() != 23 || date.time().minute() != 59 || date.time().second() != 59
            {
                return Err(CalendarError::CorruptStoredData);
            }
            end = EventRecurrenceEndDto::OnDate {
                date: date.date().to_string(),
            };
            ended = true;
        } else {
            return Err(CalendarError::CorruptStoredData);
        }
    }
    let result = match frequency {
        "FREQ=DAILY" => EventRecurrenceDto::Daily { end },
        "FREQ=WEEKLY" => EventRecurrenceDto::Weekly { weekdays, end },
        "FREQ=MONTHLY" => EventRecurrenceDto::Monthly { end },
        "FREQ=YEARLY" => EventRecurrenceDto::Yearly { end },
        _ => return Err(CalendarError::CorruptStoredData),
    };
    // A matching base weekday lets the canonical encoder validate ordering and clauses.
    let start = if let EventRecurrenceDto::Weekly { weekdays, .. } = &result {
        NaiveDate::from_ymd_opt(1900, 1, 1).unwrap()
            + Duration::days(weekdays.first().map_or(0, weekday_number) as i64)
    } else {
        NaiveDate::from_ymd_opt(1900, 1, 1).unwrap()
    };
    if canonical_recurrence(&mut result.clone(), start)
        // Redacts parser details to the matching domain error.
        .map_err(|_| CalendarError::CorruptStoredData)?
        .as_deref()
        != Some(rule)
    {
        return Err(CalendarError::CorruptStoredData);
    }
    Ok(result)
}

/// Normalizes all persisted definition fields before CRUD or backup writes.
pub(crate) fn normalize_event(mut input: EventInputDto) -> Result<NormalizedEvent, CalendarError> {
    input.title = input.title.trim().to_owned();
    if input.title.is_empty()
        || input.title.chars().count() > 200
        // Checks each value against the domain invariant.
        || input.title.chars().any(char::is_control)
    {
        return Err(CalendarError::InvalidTitle);
    }
    input.description = input.description.replace("\r\n", "\n").replace('\r', "\n");
    if input.description.chars().count() > 20000
        || input
            .description
            .chars()
            // Checks each value against the domain invariant.
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(CalendarError::DescriptionTooLong);
    }
    if let Some(id) = &input.project_id {
        validate_id(id, CalendarError::InvalidProjectId)?;
    }
    if input.reminder_minutes_before.len() > 16 {
        return Err(CalendarError::TooManyReminders);
    }
    let mut offsets = BTreeSet::new();
    for offset in &input.reminder_minutes_before {
        if *offset > 525600 {
            return Err(CalendarError::InvalidReminderOffset);
        }
        if !offsets.insert(*offset) {
            return Err(CalendarError::DuplicateReminder);
        }
    }
    input
        .reminder_minutes_before
        // Keeps reminder offsets in descending display order.
        .sort_unstable_by(|a, b| b.cmp(a));
    let (all_day, start, end, zone) = match &input.time {
        EventTimeInputDto::Timed {
            start_local,
            end_local,
            time_zone_id,
        } => (
            false,
            parse_local(start_local)?,
            parse_local(end_local)?,
            time_zone_id,
        ),
        EventTimeInputDto::AllDay {
            start_date,
            end_date_exclusive,
            time_zone_id,
        } => (
            true,
            parse_date(start_date)?.and_hms_opt(0, 0, 0).unwrap(),
            parse_date(end_date_exclusive)?
                .and_hms_opt(0, 0, 0)
                .unwrap(),
            time_zone_id,
        ),
    };
    let timezone = zone
        .parse::<Tz>()
        // Redacts parser details to the matching domain error.
        .map_err(|_| CalendarError::InvalidTimeZone)?;
    let duration = end - start;
    if duration <= Duration::zero() || duration > Duration::days(366) {
        return Err(CalendarError::InvalidTimeRange);
    }
    let (start_ms, end_ms) = if all_day {
        (None, None)
    } else {
        let a = resolve_local(start, timezone).ok_or(CalendarError::NonexistentLocalTime)?;
        let b = resolve_local(end, timezone).ok_or(CalendarError::NonexistentLocalTime)?;
        if b <= a || b - a > Duration::days(366).num_milliseconds() {
            return Err(CalendarError::InvalidTimeRange);
        }
        (Some(a), Some(b))
    };
    let time_zone_id = timezone.name().to_owned();
    let start_local = start
        .format(if all_day {
            "%Y-%m-%d"
        } else {
            "%Y-%m-%dT%H:%M"
        })
        .to_string();
    let end_local = end
        .format(if all_day {
            "%Y-%m-%d"
        } else {
            "%Y-%m-%dT%H:%M"
        })
        .to_string();
    let time = if all_day {
        EventTimeDto::AllDay {
            start_date: start_local.clone(),
            end_date_exclusive: end_local.clone(),
            time_zone_id: time_zone_id.clone(),
        }
    } else {
        EventTimeDto::Timed {
            start_local: start_local.clone(),
            end_local: end_local.clone(),
            time_zone_id: time_zone_id.clone(),
            start_at_ms: start_ms.unwrap(),
            end_at_ms: end_ms.unwrap(),
        }
    };
    let recurrence_rule = canonical_recurrence(&mut input.recurrence, start.date())?;
    let search_text = format!("{} {}", input.title, input.description)
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    Ok(NormalizedEvent {
        input,
        time,
        is_all_day: all_day,
        start_local,
        end_local,
        time_zone_id,
        start_at_ms: start_ms,
        end_at_ms: end_ms,
        recurrence_rule,
        search_text,
    })
}

/// Projects a bounded series while counting only valid domain occurrences.
pub(crate) fn expand_event(
    event: &CalendarEventDto,
    from_ms: i64,
    to_ms: i64,
    date_start: NaiveDate,
    date_end: NaiveDate,
    limit: usize,
) -> Result<Vec<ResolvedOccurrence>, CalendarError> {
    let (all_day, base_start, base_end, timezone) = match &event.time {
        EventTimeDto::Timed {
            start_local,
            end_local,
            time_zone_id,
            ..
        } => (
            false,
            parse_local(start_local)?,
            parse_local(end_local)?,
            time_zone_id
                .parse::<Tz>()
                // Redacts parser details to the matching domain error.
                .map_err(|_| CalendarError::CorruptStoredData)?,
        ),
        EventTimeDto::AllDay {
            start_date,
            end_date_exclusive,
            time_zone_id,
        } => (
            true,
            parse_date(start_date)?.and_hms_opt(0, 0, 0).unwrap(),
            parse_date(end_date_exclusive)?
                .and_hms_opt(0, 0, 0)
                .unwrap(),
            time_zone_id
                .parse::<Tz>()
                // Redacts parser details to the matching domain error.
                .map_err(|_| CalendarError::CorruptStoredData)?,
        ),
    };
    let duration = base_end - base_start;
    let utc_end = chrono::DateTime::<Utc>::from_timestamp_millis(to_ms)
        .ok_or(CalendarError::DateOutOfRange)?;
    let utc_start = chrono::DateTime::<Utc>::from_timestamp_millis(from_ms)
        .ok_or(CalendarError::DateOutOfRange)?;
    let upper_date = if all_day {
        date_end
    } else {
        utc_end.with_timezone(&timezone).date_naive()
    };
    let upper = upper_date
        .and_hms_opt(23, 59, 59)
        .ok_or(CalendarError::DateOutOfRange)?;
    if base_start > upper {
        return Ok(Vec::new());
    }
    let count = match recurrence_end(&event.recurrence) {
        Some(EventRecurrenceEndDto::AfterCount { count }) => Some(*count),
        _ => None,
    };
    let until = match recurrence_end(&event.recurrence) {
        Some(EventRecurrenceEndDto::OnDate { date }) => Some(parse_date(date)?),
        _ => None,
    };
    let mut recurrence = event.recurrence.clone();
    let canonical = canonical_recurrence(&mut recurrence, base_start.date())?;
    let mut items = Vec::new();
    let mut valid_count = 0u32;
    // UTC is only a floating calendar carrier here; actual instants resolve below.
    let candidates: Box<dyn Iterator<Item = NaiveDateTime>> = if let Some(rule) = canonical {
        let mut rule = rule
            .split(';')
            // Removes library termination so the domain counts valid occurrences.
            .filter(|part| !part.starts_with("COUNT=") && !part.starts_with("UNTIL="))
            .collect::<Vec<_>>()
            .join(";");
        match &event.recurrence {
            EventRecurrenceDto::Monthly { .. } => {
                rule.push_str(&format!(";BYMONTHDAY={}", base_start.day()))
            }
            EventRecurrenceDto::Yearly { .. } => rule.push_str(&format!(
                ";BYMONTH={};BYMONTHDAY={}",
                base_start.month(),
                base_start.day()
            )),
            _ => {}
        }
        let lower_date = if all_day {
            date_start
        } else {
            utc_start.with_timezone(&timezone).date_naive()
        };
        let lower = lower_date
            .checked_sub_signed(Duration::days(duration.num_days() + 2))
            .ok_or(CalendarError::DateOutOfRange)?
            .and_time(base_start.time());
        let anchor = if count.is_some() {
            base_start
        } else {
            base_start.max(lower)
        };
        // Restricts expansion to the inclusive recurrence end date.
        let bounded_upper = until.map_or(upper, |date| {
            upper.min(date.and_hms_opt(23, 59, 59).unwrap())
        });
        if anchor > bounded_upper {
            return Ok(items);
        }
        rule.push_str(&format!(
            ";UNTIL={}Z",
            bounded_upper.format("%Y%m%dT%H%M%S")
        ));
        let set = format!("DTSTART:{}Z\nRRULE:{rule}", anchor.format("%Y%m%dT%H%M%S"))
            .parse::<rrule::RRuleSet>()
            // Redacts parser details to the matching domain error.
            .map_err(|_| CalendarError::InvalidRecurrence)?;
        // The fixed calendar domain bounds even centuries-old series without materialization.
        let bound = (bounded_upper.date() - anchor.date()).num_days() as usize + 1;
        Box::new(
            set.limit()
                .into_iter()
                .take(bound)
                // Projects each value into the normalized representation.
                .map(|date| date.naive_utc()),
        )
    } else {
        Box::new(std::iter::once(base_start))
    };
    for start in candidates {
        if start > upper || start.year() > 9999 {
            break;
        }
        let Some(end) = start.checked_add_signed(duration) else {
            return Err(CalendarError::DateOutOfRange);
        };
        if end.year() > 9999 {
            return Err(CalendarError::DateOutOfRange);
        }
        let (start_ms, end_ms) = if all_day {
            let Some(start_ms) = first_instant(start.date(), timezone) else {
                continue;
            };
            (start_ms, range_boundary(end.date(), timezone)?)
        } else {
            let (Some(a), Some(b)) = (resolve_local(start, timezone), resolve_local(end, timezone))
            else {
                continue;
            };
            if b <= a {
                continue;
            }
            (a, b)
        };
        valid_count += 1;
        let overlaps = if all_day {
            start.date() < date_end && end.date() > date_start
        } else {
            start_ms < to_ms && end_ms > from_ms
        };
        if overlaps {
            if items.len() >= limit {
                return Err(CalendarError::OccurrenceLimitExceeded);
            }
            let time = if all_day {
                EventTimeDto::AllDay {
                    start_date: start.date().to_string(),
                    end_date_exclusive: end.date().to_string(),
                    time_zone_id: timezone.name().to_owned(),
                }
            } else {
                EventTimeDto::Timed {
                    start_local: start.format("%Y-%m-%dT%H:%M").to_string(),
                    end_local: end.format("%Y-%m-%dT%H:%M").to_string(),
                    time_zone_id: timezone.name().to_owned(),
                    start_at_ms: start_ms,
                    end_at_ms: end_ms,
                }
            };
            let occurrence_id = if all_day {
                format!("{}@d:{}:{start_ms}", event.id, start.date())
            } else {
                format!("{}@t:{start_ms}", event.id)
            };
            items.push(ResolvedOccurrence {
                dto: CalendarOccurrenceDto {
                    occurrence_id,
                    event_id: event.id.clone(),
                    title: event.title.clone(),
                    project_id: event.project_id.clone(),
                    time,
                    recurrence: event.recurrence.clone(),
                    reminders: event.reminders.clone(),
                },
                starts_at_ms: start_ms,
            });
        }
        // Stops after the requested number of valid domain occurrences.
        if count.is_some_and(|count| valid_count >= count) {
            break;
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a minimal timed definition for pure recurrence checks.
    fn input(start: &str, end: &str, zone: &str, recurrence: EventRecurrenceDto) -> EventInputDto {
        EventInputDto {
            title: "  Planning  ".into(),
            description: "A\r\nB".into(),
            project_id: None,
            time: EventTimeInputDto::Timed {
                start_local: start.into(),
                end_local: end.into(),
                time_zone_id: zone.into(),
            },
            recurrence,
            reminder_minutes_before: vec![0, 60],
        }
    }

    /// Wraps normalized values in a stable series identity.
    fn event(input: EventInputDto) -> CalendarEventDto {
        let normalized = normalize_event(input).unwrap();
        CalendarEventDto {
            id: "00000000-0000-4000-8000-000000000001".into(),
            title: normalized.input.title,
            description: normalized.input.description,
            project_id: None,
            time: normalized.time,
            recurrence: normalized.input.recurrence,
            reminders: vec![],
            revision: "1".into(),
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    /// Expands a UTC viewer range through the same production entry point.
    fn occurrences(event: &CalendarEventDto, start: &str, end: &str) -> Vec<ResolvedOccurrence> {
        let start = parse_date(start).unwrap();
        let end = parse_date(end).unwrap();
        expand_event(
            event,
            first_instant(start, Tz::UTC).unwrap(),
            first_instant(end, Tz::UTC).unwrap(),
            start,
            end,
            5000,
        )
        .unwrap()
    }

    /// Extracts wall-clock starts without conflating them with viewer dates.
    fn starts(items: &[ResolvedOccurrence]) -> Vec<String> {
        items
            .iter()
            // Projects each value into the normalized representation.
            .map(|item| match &item.dto.time {
                EventTimeDto::Timed { start_local, .. } => start_local.clone(),
                EventTimeDto::AllDay { start_date, .. } => start_date.clone(),
            })
            .collect()
    }

    /// Ensures basic normalized input and round-trip canonical RRULE are usable.
    #[test]
    fn normalizes_text_reminders_and_canonical_recurrence() {
        let normalized = normalize_event(input(
            "2026-09-07T09:00",
            "2026-09-07T10:00",
            "UTC",
            EventRecurrenceDto::Weekly {
                weekdays: vec![CalendarWeekdayDto::Friday, CalendarWeekdayDto::Monday],
                end: EventRecurrenceEndDto::AfterCount { count: 10 },
            },
        ))
        .unwrap();
        assert_eq!(normalized.input.title, "Planning");
        assert_eq!(normalized.input.description, "A\nB");
        assert_eq!(normalized.input.reminder_minutes_before, vec![60, 0]);
        assert_eq!(
            normalized.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR;COUNT=10")
        );
        assert_eq!(
            decode_recurrence(normalized.recurrence_rule.as_deref()).unwrap(),
            normalized.input.recurrence
        );
        assert!(decode_recurrence(Some("FREQ=DAILY;INTERVAL=1;COUNT=1;COUNT=2")).is_err());
    }

    /// Rejects malformed domain values before persistence.
    #[test]
    fn rejects_invalid_text_time_offsets_and_ids() {
        let base = input(
            "2026-09-07T09:00",
            "2026-09-07T10:00",
            "UTC",
            EventRecurrenceDto::None,
        );
        let mut value = base.clone();
        value.title = "\0".into();
        assert!(matches!(
            normalize_event(value),
            Err(CalendarError::InvalidTitle)
        ));
        let mut value = base.clone();
        value.reminder_minutes_before = vec![1, 1];
        assert!(matches!(
            normalize_event(value),
            Err(CalendarError::DuplicateReminder)
        ));
        let mut value = base.clone();
        value.reminder_minutes_before = vec![525601];
        assert!(matches!(
            normalize_event(value),
            Err(CalendarError::InvalidReminderOffset)
        ));
        let mut value = base.clone();
        value.reminder_minutes_before = (0..17).collect();
        assert!(matches!(
            normalize_event(value),
            Err(CalendarError::TooManyReminders)
        ));
        let mut value = base;
        value.recurrence = EventRecurrenceDto::Weekly {
            weekdays: vec![CalendarWeekdayDto::Tuesday],
            end: EventRecurrenceEndDto::Never,
        };
        assert!(matches!(
            normalize_event(value),
            Err(CalendarError::InvalidRecurrence)
        ));
        assert!(
            validate_id(
                "00000000-0000-4000-8000-00000000000A",
                CalendarError::InvalidEventId
            )
            .is_err()
        );
        for revision in ["0", "01", "+1", "9223372036854775808"] {
            assert!(validate_revision(revision).is_err());
        }
        assert!(matches!(
            parse_date("1899-12-31"),
            Err(CalendarError::DateOutOfRange)
        ));
        assert!(parse_date("2026-9-01").is_err());
        assert!(parse_local("2026-09-01T00:00:00").is_err());
    }

    /// Counts future DST gaps only after both endpoints resolve.
    #[test]
    fn dst_gaps_do_not_consume_count() {
        let e = event(input(
            "2026-03-07T02:30",
            "2026-03-07T03:30",
            "America/New_York",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::AfterCount { count: 3 },
            },
        ));
        let found = occurrences(&e, "2026-03-07", "2026-03-12");
        assert_eq!(
            starts(&found),
            vec!["2026-03-07T02:30", "2026-03-09T02:30", "2026-03-10T02:30"]
        );
        let e = event(input(
            "2026-03-07T01:30",
            "2026-03-07T02:30",
            "America/New_York",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::AfterCount { count: 2 },
            },
        ));
        assert_eq!(
            starts(&occurrences(&e, "2026-03-07", "2026-03-11")),
            vec!["2026-03-07T01:30", "2026-03-09T01:30"]
        );
        assert!(matches!(
            normalize_event(input(
                "2026-03-08T02:30",
                "2026-03-08T03:30",
                "America/New_York",
                EventRecurrenceDto::None
            )),
            Err(CalendarError::NonexistentLocalTime)
        ));
    }

    /// Selects the earliest UTC instant for repeated wall-clock times.
    #[test]
    fn ambiguous_time_uses_earlier_utc_branch() {
        let local = parse_local("2026-11-01T01:30").unwrap();
        assert_eq!(
            resolve_local(local, Tz::America__New_York),
            Some(
                Utc.with_ymd_and_hms(2026, 11, 1, 5, 30, 0)
                    .unwrap()
                    .timestamp_millis()
            )
        );
    }

    /// Skips missing month dates and leap dates without consuming count.
    #[test]
    fn monthly_and_yearly_skip_invalid_calendar_dates() {
        let e = event(input(
            "2026-01-31T09:00",
            "2026-01-31T10:00",
            "UTC",
            EventRecurrenceDto::Monthly {
                end: EventRecurrenceEndDto::AfterCount { count: 3 },
            },
        ));
        assert_eq!(
            starts(&occurrences(&e, "2026-01-01", "2026-06-01")),
            vec!["2026-01-31T09:00", "2026-03-31T09:00", "2026-05-31T09:00"]
        );
        let e = event(input(
            "2024-02-29T09:00",
            "2024-02-29T10:00",
            "UTC",
            EventRecurrenceDto::Yearly {
                end: EventRecurrenceEndDto::AfterCount { count: 2 },
            },
        ));
        assert_eq!(
            starts(&occurrences(&e, "2024-01-01", "2030-01-01")),
            vec!["2024-02-29T09:00", "2028-02-29T09:00"]
        );
    }

    /// Expands multiple weekly weekdays and exhausts ancient high-count series safely.
    #[test]
    fn weekly_days_and_old_high_count_are_bounded() {
        let e = event(input(
            "2026-09-07T09:00",
            "2026-09-07T10:00",
            "UTC",
            EventRecurrenceDto::Weekly {
                weekdays: vec![CalendarWeekdayDto::Friday, CalendarWeekdayDto::Monday],
                end: EventRecurrenceEndDto::AfterCount { count: 3 },
            },
        ));
        assert_eq!(
            starts(&occurrences(&e, "2026-09-07", "2026-09-20")),
            vec!["2026-09-07T09:00", "2026-09-11T09:00", "2026-09-14T09:00"]
        );
        let e = event(input(
            "1900-01-01T09:00",
            "1900-01-01T10:00",
            "UTC",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::AfterCount { count: 10000 },
            },
        ));
        assert!(occurrences(&e, "9999-01-01", "9999-01-03").is_empty());
    }

    /// Resolves midnight gaps, repeated midnight and fully skipped dates.
    #[test]
    fn all_day_first_instant_handles_zone_transitions() {
        let sao = parse_date("2018-11-04").unwrap();
        let instant = first_instant(sao, Tz::America__Sao_Paulo).unwrap();
        assert_eq!(
            chrono::DateTime::<Utc>::from_timestamp_millis(instant)
                .unwrap()
                .with_timezone(&Tz::America__Sao_Paulo)
                .hour(),
            1
        );
        assert!(first_instant(parse_date("2011-12-30").unwrap(), Tz::Pacific__Apia).is_none());
        let havana = parse_date("2020-11-01").unwrap();
        let LocalResult::Ambiguous(a, b) =
            Tz::America__Havana.from_local_datetime(&havana.and_hms_opt(0, 0, 0).unwrap())
        else {
            panic!("fixture must contain midnight fold");
        };
        assert_eq!(
            first_instant(havana, Tz::America__Havana),
            Some(a.timestamp_millis().min(b.timestamp_millis()))
        );
    }

    /// Keeps all-day dates floating and skips a missing start day before count.
    #[test]
    fn all_day_count_skips_missing_day_and_keeps_floating_date() {
        let mut value = input(
            "2011-12-29T09:00",
            "2011-12-29T10:00",
            "UTC",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::AfterCount { count: 3 },
            },
        );
        value.time = EventTimeInputDto::AllDay {
            start_date: "2011-12-29".into(),
            end_date_exclusive: "2011-12-30".into(),
            time_zone_id: "Pacific/Apia".into(),
        };
        let e = event(value);
        let found = occurrences(&e, "2011-12-28", "2012-01-03");
        assert_eq!(
            starts(&found),
            vec!["2011-12-29", "2011-12-31", "2012-01-01"]
        );
        assert!(found[0].dto.occurrence_id.contains("@d:2011-12-29:"));
    }

    /// Applies inclusive end dates and strict half-open overlap.
    #[test]
    fn inclusive_until_and_overlap_are_exact() {
        let e = event(input(
            "2026-09-01T23:30",
            "2026-09-02T01:30",
            "UTC",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::OnDate {
                    date: "2026-09-02".into(),
                },
            },
        ));
        assert_eq!(
            starts(&occurrences(&e, "2026-09-02", "2026-09-03")),
            vec!["2026-09-01T23:30", "2026-09-02T23:30"]
        );
        assert!(occurrences(&e, "2026-09-04", "2026-09-05").is_empty());
    }

    /// Anchors old unbounded series close to the query while preserving wall time.
    #[test]
    fn old_series_expansion_is_bounded_and_limits_are_errors() {
        let e = event(input(
            "1900-01-01T09:15",
            "1900-01-01T10:30",
            "UTC",
            EventRecurrenceDto::Daily {
                end: EventRecurrenceEndDto::Never,
            },
        ));
        let found = occurrences(&e, "9999-01-01", "9999-01-03");
        assert_eq!(starts(&found), vec!["9999-01-01T09:15", "9999-01-02T09:15"]);
        let start = parse_date("2026-09-01").unwrap();
        let end = parse_date("2026-09-03").unwrap();
        assert!(matches!(
            expand_event(
                &e,
                first_instant(start, Tz::UTC).unwrap(),
                first_instant(end, Tz::UTC).unwrap(),
                start,
                end,
                1
            ),
            Err(CalendarError::OccurrenceLimitExceeded)
        ));
        let mut range = CalendarRangeInputDto {
            start_date: "2026-01-01".into(),
            end_date_exclusive: "2026-03-04".into(),
            viewer_time_zone_id: "UTC".into(),
            project_id: None,
            only_with_reminders: false,
        };
        assert!(normalize_range(&range).is_ok());
        range.end_date_exclusive = "2026-03-05".into();
        assert!(matches!(
            normalize_range(&range),
            Err(CalendarError::InvalidRange)
        ));
    }
}
