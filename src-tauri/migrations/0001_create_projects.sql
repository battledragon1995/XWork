CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    display_name TEXT NOT NULL
        CHECK(length(trim(display_name)) BETWEEN 1 AND 255),
    root_path TEXT NOT NULL CHECK(length(root_path) > 0),
    path_key TEXT NOT NULL UNIQUE CHECK(length(path_key) > 0),
    is_pinned INTEGER NOT NULL DEFAULT 0
        CHECK(is_pinned IN (0, 1)),
    added_at_ms INTEGER NOT NULL CHECK(added_at_ms >= 0),
    last_opened_at_ms INTEGER NOT NULL
        CHECK(last_opened_at_ms >= added_at_ms)
) STRICT;

CREATE INDEX idx_projects_list_order
    ON projects(is_pinned DESC, added_at_ms ASC, id ASC);
