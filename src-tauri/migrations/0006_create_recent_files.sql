CREATE TABLE recent_files (
    project_id TEXT NOT NULL,
    path_key TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    opened_at_ms INTEGER NOT NULL CHECK (opened_at_ms >= 0),
    PRIMARY KEY (project_id, path_key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (length(path_key) BETWEEN 1 AND 4096),
    CHECK (length(relative_path) BETWEEN 1 AND 4096)
) WITHOUT ROWID;

CREATE INDEX recent_files_by_project_opened
    ON recent_files(project_id, opened_at_ms DESC, path_key ASC);
