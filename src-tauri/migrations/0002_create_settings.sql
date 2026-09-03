CREATE TABLE settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('light', 'dark', 'system')),
    theme_preset TEXT NOT NULL DEFAULT 'cream' CHECK (theme_preset IN ('cream', 'ink', 'paper', 'custom')),
    light_accent_color TEXT NOT NULL DEFAULT '#cc785c',
    light_canvas_color TEXT NOT NULL DEFAULT '#faf9f5',
    light_sidebar_color TEXT NOT NULL DEFAULT '#f5f0e8',
    light_text_color TEXT NOT NULL DEFAULT '#141413',
    dark_accent_color TEXT NOT NULL DEFAULT '#e08a6c',
    dark_canvas_color TEXT NOT NULL DEFAULT '#1e1b18',
    dark_sidebar_color TEXT NOT NULL DEFAULT '#26211d',
    dark_text_color TEXT NOT NULL DEFAULT '#f7f2ea',
    terminal_background TEXT NOT NULL DEFAULT '#181715',
    terminal_foreground TEXT NOT NULL DEFAULT '#faf9f5',
    terminal_ansi_colors_json TEXT NOT NULL DEFAULT '["#181715","#c64545","#5db872","#e8a55a","#93b4d6","#b48ead","#5db8a6","#a09d96","#3d3d3a","#e08a8a","#8fd19e","#f0c48a","#b4cde6","#d0b0d8","#8ed4c6","#faf9f5"]' CHECK (json_valid(terminal_ansi_colors_json)),
    interface_font_size_px INTEGER NOT NULL DEFAULT 14 CHECK (interface_font_size_px BETWEEN 12 AND 20),
    terminal_font_size_px INTEGER NOT NULL DEFAULT 13 CHECK (terminal_font_size_px BETWEEN 10 AND 24),
    sidebar_width_px INTEGER NOT NULL DEFAULT 280 CHECK (sidebar_width_px BETWEEN 200 AND 420),
    sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (sidebar_collapsed IN (0, 1))
);

INSERT INTO settings (id) VALUES (1);
