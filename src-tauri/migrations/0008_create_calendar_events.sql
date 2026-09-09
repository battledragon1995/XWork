CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT NULL REFERENCES projects(id) ON DELETE SET NULL,
    is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
    start_local TEXT NOT NULL,
    end_local TEXT NOT NULL,
    time_zone_id TEXT NOT NULL,
    start_at_ms INTEGER NULL,
    end_at_ms INTEGER NULL,
    recurrence_rule TEXT NULL,
    search_text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    CHECK (
        (is_all_day = 1
            AND length(start_local) = 10
            AND length(end_local) = 10
            AND start_at_ms IS NULL
            AND end_at_ms IS NULL)
        OR
        (is_all_day = 0
            AND length(start_local) = 16
            AND length(end_local) = 16
            AND start_at_ms IS NOT NULL
            AND end_at_ms IS NOT NULL
            AND end_at_ms > start_at_ms)
    ),
    CHECK (end_local > start_local),
    CHECK (recurrence_rule IS NULL OR length(recurrence_rule) BETWEEN 1 AND 256)
) STRICT;

CREATE TABLE event_reminders (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    minutes_before INTEGER NOT NULL
        CHECK (minutes_before BETWEEN 0 AND 525600),
    UNIQUE (event_id, minutes_before)
) STRICT;

CREATE INDEX idx_calendar_events_project
    ON calendar_events(project_id);
CREATE INDEX idx_calendar_events_timed_range
    ON calendar_events(start_at_ms, end_at_ms)
    WHERE is_all_day = 0 AND recurrence_rule IS NULL;
CREATE INDEX idx_calendar_events_all_day_range
    ON calendar_events(start_local, end_local)
    WHERE is_all_day = 1 AND recurrence_rule IS NULL;
CREATE INDEX idx_calendar_events_recurring_start
    ON calendar_events(is_all_day, start_local)
    WHERE recurrence_rule IS NOT NULL;
CREATE INDEX idx_calendar_events_search
    ON calendar_events(search_text);
CREATE INDEX idx_event_reminders_event
    ON event_reminders(event_id, minutes_before DESC);
