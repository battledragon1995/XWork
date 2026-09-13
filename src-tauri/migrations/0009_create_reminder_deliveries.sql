CREATE TABLE reminder_scheduler_state (
    singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
    scan_through_ms INTEGER NULL CHECK (scan_through_ms IS NULL OR scan_through_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

INSERT INTO reminder_scheduler_state(singleton_id, scan_through_ms, updated_at_ms)
VALUES (1, NULL, 0);

CREATE TABLE reminder_deliveries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 54),
    reminder_id TEXT NOT NULL CHECK (length(reminder_id) = 36),
    event_id TEXT NOT NULL CHECK (length(event_id) = 36),
    occurrence_id TEXT NOT NULL CHECK (length(occurrence_id) BETWEEN 1 AND 80),
    project_id TEXT NULL CHECK (project_id IS NULL OR length(project_id) = 36),
    title_snapshot TEXT NOT NULL CHECK (length(trim(title_snapshot)) BETWEEN 1 AND 200),
    starts_at_ms INTEGER NOT NULL,
    original_due_at_ms INTEGER NOT NULL,
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) BETWEEN 1 AND 64),
    minutes_before INTEGER NOT NULL CHECK (minutes_before BETWEEN 0 AND 525600),
    status TEXT NOT NULL CHECK (
        status IN ('active', 'missed', 'snoozed', 'dismissed', 'suppressed', 'cancelled')
    ),
    next_fire_at_ms INTEGER NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    version INTEGER NOT NULL CHECK (version >= 1),
    notification_sync TEXT NOT NULL CHECK (
        notification_sync IN ('none', 'upsert_pending', 'synced', 'delete_pending')
    ),
    notification_retry_at_ms INTEGER NULL,
    notification_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (notification_retry_count >= 0),
    os_state TEXT NOT NULL CHECK (
        os_state IN ('none', 'pending', 'suppressed_visible', 'attempted')
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    UNIQUE (reminder_id, occurrence_id),
    CHECK (
        (status = 'snoozed' AND next_fire_at_ms IS NOT NULL)
        OR (status <> 'snoozed' AND next_fire_at_ms IS NULL)
    ),
    CHECK (
        (notification_sync IN ('upsert_pending', 'delete_pending')
            AND notification_retry_at_ms IS NOT NULL)
        OR (notification_sync IN ('none', 'synced')
            AND notification_retry_at_ms IS NULL)
    ),
    CHECK (status = 'active' OR os_state = 'none')
) STRICT;

CREATE INDEX idx_reminder_deliveries_missed
    ON reminder_deliveries(original_due_at_ms DESC, id DESC)
    WHERE status = 'missed';
CREATE INDEX idx_reminder_deliveries_snoozed
    ON reminder_deliveries(next_fire_at_ms, id)
    WHERE status = 'snoozed';
CREATE INDEX idx_reminder_deliveries_notification_sync
    ON reminder_deliveries(notification_retry_at_ms, id)
    WHERE notification_sync IN ('upsert_pending', 'delete_pending');
CREATE INDEX idx_reminder_deliveries_event
    ON reminder_deliveries(event_id, occurrence_id, reminder_id);

ALTER TABLE notifications RENAME TO notifications_v5;

CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 49),
    source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
    source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 255),
    source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 320),
    kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    context TEXT NOT NULL CHECK (length(context) BETWEEN 1 AND 240),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'event')),
    project_id TEXT NULL CHECK (project_id IS NULL OR length(project_id) = 36),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 255),
    tab_id TEXT NULL CHECK (tab_id IS NULL OR length(tab_id) BETWEEN 1 AND 255),
    pane_id TEXT NULL CHECK (pane_id IS NULL OR length(pane_id) BETWEEN 1 AND 255),
    status_code TEXT NULL CHECK (
        status_code IS NULL OR length(status_code) BETWEEN 1 AND 20
    ),
    occurrence_id TEXT NULL CHECK (
        occurrence_id IS NULL OR length(occurrence_id) BETWEEN 1 AND 80
    ),
    reminder_delivery_id TEXT NULL CHECK (
        reminder_delivery_id IS NULL OR length(reminder_delivery_id) = 54
    ),
    delivery_version INTEGER NULL CHECK (
        delivery_version IS NULL OR delivery_version >= 1
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    read_at_ms INTEGER NULL CHECK (
        read_at_ms IS NULL OR read_at_ms >= created_at_ms
    ),
    CHECK (
        (target_kind = 'session'
            AND project_id IS NOT NULL
            AND tab_id IS NOT NULL
            AND pane_id IS NOT NULL
            AND occurrence_id IS NULL
            AND reminder_delivery_id IS NULL
            AND delivery_version IS NULL)
        OR
        (target_kind = 'event'
            AND length(target_id) = 36
            AND tab_id IS NULL
            AND pane_id IS NULL
            AND status_code IS NULL
            AND occurrence_id IS NOT NULL
            AND reminder_delivery_id IS NOT NULL
            AND delivery_version IS NOT NULL)
    )
);

INSERT INTO notifications (
    id, source_kind, source_id, source_key, kind, title, context,
    target_kind, project_id, target_id, tab_id, pane_id, status_code,
    occurrence_id, reminder_delivery_id, delivery_version,
    created_at_ms, read_at_ms
)
SELECT
    id, source_kind, source_id, source_key, kind, title, context,
    target_kind, project_id, target_id, tab_id, pane_id, status_code,
    NULL, NULL, NULL, created_at_ms, read_at_ms
FROM notifications_v5;

DROP TABLE notifications_v5;

CREATE INDEX idx_notifications_order
    ON notifications(created_at_ms DESC, id DESC);
CREATE INDEX idx_notifications_unread
    ON notifications(created_at_ms DESC, id DESC)
    WHERE read_at_ms IS NULL;
CREATE INDEX idx_notifications_source
    ON notifications(source_kind, source_id, kind);
CREATE INDEX idx_notifications_target
    ON notifications(target_kind, target_id);
