CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 49),
    source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
    source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 255),
    source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 320),
    kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    context TEXT NOT NULL CHECK (length(context) BETWEEN 1 AND 240),
    target_kind TEXT NOT NULL CHECK (length(target_kind) BETWEEN 1 AND 32),
    project_id TEXT NOT NULL CHECK (length(project_id) = 36),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 255),
    tab_id TEXT NOT NULL CHECK (length(tab_id) BETWEEN 1 AND 255),
    pane_id TEXT NOT NULL CHECK (length(pane_id) BETWEEN 1 AND 255),
    status_code TEXT CHECK (status_code IS NULL OR length(status_code) BETWEEN 1 AND 20),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    read_at_ms INTEGER CHECK (read_at_ms IS NULL OR read_at_ms >= created_at_ms)
);

CREATE INDEX idx_notifications_order
    ON notifications(created_at_ms DESC, id DESC);
CREATE INDEX idx_notifications_unread
    ON notifications(created_at_ms DESC, id DESC)
    WHERE read_at_ms IS NULL;
CREATE INDEX idx_notifications_source
    ON notifications(source_kind, source_id, kind);
CREATE INDEX idx_notifications_target
    ON notifications(target_kind, target_id);
