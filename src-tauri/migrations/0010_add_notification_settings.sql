ALTER TABLE settings ADD COLUMN terminal_activity_notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (terminal_activity_notifications_enabled IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_needs_input INTEGER NOT NULL DEFAULT 1 CHECK (notify_os_needs_input IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_process_finished INTEGER NOT NULL DEFAULT 0 CHECK (notify_os_process_finished IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_process_exited_with_error INTEGER NOT NULL DEFAULT 1 CHECK (notify_os_process_exited_with_error IN (0, 1));
ALTER TABLE settings ADD COLUMN event_reminder_notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (event_reminder_notifications_enabled IN (0, 1));
