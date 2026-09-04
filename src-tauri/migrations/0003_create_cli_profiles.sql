CREATE TABLE cli_profile_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
    default_shell_id TEXT NOT NULL DEFAULT 'system'
        CHECK(length(default_shell_id) BETWEEN 1 AND 64)
) STRICT;

INSERT INTO cli_profile_settings (id, default_shell_id)
VALUES (1, 'system');

CREATE TABLE cli_profiles (
    id TEXT PRIMARY KEY NOT NULL
        CHECK(length(id) = 44 AND substr(id, 1, 8) = 'profile-'),
    name TEXT NOT NULL
        CHECK(length(trim(name)) BETWEEN 1 AND 80),
    command TEXT NOT NULL
        CHECK(length(command) BETWEEN 1 AND 1024),
    arguments_json TEXT NOT NULL DEFAULT '[]'
        CHECK(json_valid(arguments_json) AND json_type(arguments_json) = 'array'),
    shell_id TEXT
        CHECK(shell_id IS NULL OR length(shell_id) BETWEEN 1 AND 64),
    icon TEXT NOT NULL
        CHECK(length(icon) BETWEEN 1 AND 16),
    color TEXT NOT NULL
        CHECK(
            length(color) = 7
            AND substr(color, 1, 1) = '#'
            AND substr(color, 2) NOT GLOB '*[^0-9a-f]*'
        ),
    created_at_ms INTEGER NOT NULL
        CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL
        CHECK(updated_at_ms >= created_at_ms)
) STRICT;

CREATE TABLE cli_profile_environment (
    profile_id TEXT NOT NULL
        REFERENCES cli_profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    name TEXT COLLATE NOCASE NOT NULL,
    value TEXT,
    is_secret INTEGER NOT NULL CHECK(is_secret IN (0, 1)),
    credential_account TEXT UNIQUE,
    PRIMARY KEY (profile_id, name),
    UNIQUE (profile_id, position),
    CHECK (
        (is_secret = 0 AND value IS NOT NULL AND credential_account IS NULL)
        OR
        (is_secret = 1 AND value IS NULL AND credential_account IS NOT NULL)
    )
) STRICT;

CREATE TABLE credential_cleanup_queue (
    credential_account TEXT PRIMARY KEY NOT NULL,
    queued_at_ms INTEGER NOT NULL CHECK(queued_at_ms >= 0)
) STRICT;
