CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    title TEXT CHECK(
        title IS NULL OR length(title) BETWEEN 1 AND 255
    ),
    content_markdown TEXT NOT NULL CHECK(
        length(CAST(content_markdown AS BLOB)) <= 1048576
    ),
    search_title TEXT NOT NULL,
    search_content TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
        CHECK(is_pinned IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'archived', 'trash')),
    trashed_from TEXT CHECK(
        trashed_from IS NULL OR trashed_from IN ('active', 'archived')
    ),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    archived_at_ms INTEGER CHECK(
        archived_at_ms IS NULL OR archived_at_ms >= created_at_ms
    ),
    trashed_at_ms INTEGER CHECK(
        trashed_at_ms IS NULL OR trashed_at_ms >= created_at_ms
    ),
    revision INTEGER NOT NULL DEFAULT 1
        CHECK(revision BETWEEN 1 AND 9223372036854775807),
    CHECK(
        (
            status = 'active'
            AND archived_at_ms IS NULL
            AND trashed_at_ms IS NULL
            AND trashed_from IS NULL
        ) OR (
            status = 'archived'
            AND archived_at_ms IS NOT NULL
            AND trashed_at_ms IS NULL
            AND trashed_from IS NULL
        ) OR (
            status = 'trash'
            AND trashed_at_ms IS NOT NULL
            AND trashed_from = 'active'
            AND archived_at_ms IS NULL
        ) OR (
            status = 'trash'
            AND trashed_at_ms IS NOT NULL
            AND trashed_from = 'archived'
            AND archived_at_ms IS NOT NULL
        )
    )
) STRICT;

CREATE INDEX idx_notes_active_order
    ON notes(status, is_pinned DESC, updated_at_ms DESC, id ASC);

CREATE INDEX idx_notes_project_order
    ON notes(project_id, status, is_pinned DESC, updated_at_ms DESC, id ASC);

CREATE INDEX idx_notes_archive_order
    ON notes(status, archived_at_ms DESC, id ASC);

CREATE INDEX idx_notes_trash_order
    ON notes(status, trashed_at_ms DESC, id ASC);
