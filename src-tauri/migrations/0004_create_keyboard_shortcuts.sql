CREATE TABLE keyboard_shortcut_overrides (
    action_id TEXT PRIMARY KEY NOT NULL CHECK (length(action_id) BETWEEN 1 AND 64),
    primary_modifier INTEGER NOT NULL CHECK (primary_modifier IN (0, 1)),
    alt_modifier INTEGER NOT NULL CHECK (alt_modifier IN (0, 1)),
    shift_modifier INTEGER NOT NULL CHECK (shift_modifier IN (0, 1)),
    key_code TEXT NOT NULL CHECK (length(key_code) BETWEEN 1 AND 32)
);
