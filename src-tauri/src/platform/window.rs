use serde::Serialize;
use tauri::{Runtime, WebviewWindow};
use ts_rs::TS;

/// Identifies the native main-window operation that failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "app-lifecycle.ts")]
pub enum WindowOperation {
    Show,
    Hide,
    Unminimize,
    Focus,
    Minimize,
    ReadMaximized,
    Maximize,
    Unmaximize,
}

/// Defines the native window calls used by lifecycle behavior and test doubles.
pub(crate) trait MainWindow {
    /// Shows the native window.
    fn show(&self) -> tauri::Result<()>;
    /// Hides the native window.
    fn hide(&self) -> tauri::Result<()>;
    /// Restores a minimized native window.
    fn unminimize(&self) -> tauri::Result<()>;
    /// Gives focus to the native window.
    fn focus(&self) -> tauri::Result<()>;
    /// Minimizes the native window.
    fn minimize(&self) -> tauri::Result<()>;
    /// Reads whether the native window is maximized.
    fn is_maximized(&self) -> tauri::Result<bool>;
    /// Maximizes the native window.
    fn maximize(&self) -> tauri::Result<()>;
    /// Restores a maximized native window.
    fn unmaximize(&self) -> tauri::Result<()>;
}

impl<R: Runtime> MainWindow for WebviewWindow<R> {
    /// Shows the Tauri webview window.
    fn show(&self) -> tauri::Result<()> {
        WebviewWindow::show(self)
    }

    /// Hides the Tauri webview window.
    fn hide(&self) -> tauri::Result<()> {
        WebviewWindow::hide(self)
    }

    /// Restores the Tauri webview window from a minimized state.
    fn unminimize(&self) -> tauri::Result<()> {
        WebviewWindow::unminimize(self)
    }

    /// Focuses the Tauri webview window.
    fn focus(&self) -> tauri::Result<()> {
        WebviewWindow::set_focus(self)
    }

    /// Minimizes the Tauri webview window.
    fn minimize(&self) -> tauri::Result<()> {
        WebviewWindow::minimize(self)
    }

    /// Reads the maximized state from the Tauri webview window.
    fn is_maximized(&self) -> tauri::Result<bool> {
        WebviewWindow::is_maximized(self)
    }

    /// Maximizes the Tauri webview window.
    fn maximize(&self) -> tauri::Result<()> {
        WebviewWindow::maximize(self)
    }

    /// Restores the Tauri webview window from a maximized state.
    fn unmaximize(&self) -> tauri::Result<()> {
        WebviewWindow::unmaximize(self)
    }
}

/// Shows, restores, and focuses the main window in deterministic order.
pub(crate) fn bring_to_front(window: &dyn MainWindow) -> Result<(), WindowOperation> {
    map_window_result(window.show(), WindowOperation::Show)?;
    map_window_result(window.unminimize(), WindowOperation::Unminimize)?;
    map_window_result(window.focus(), WindowOperation::Focus)
}

/// Hides the main window without changing application runtime state.
pub(crate) fn hide_window(window: &dyn MainWindow) -> Result<(), WindowOperation> {
    map_window_result(window.hide(), WindowOperation::Hide)
}

/// Minimizes the main window exactly once.
pub(crate) fn minimize_window(window: &dyn MainWindow) -> Result<(), WindowOperation> {
    map_window_result(window.minimize(), WindowOperation::Minimize)
}

/// Toggles the maximized state and returns the state after the operation.
pub(crate) fn toggle_window_maximized(window: &dyn MainWindow) -> Result<bool, WindowOperation> {
    let is_maximized = map_window_value(window.is_maximized(), WindowOperation::ReadMaximized)?;
    if is_maximized {
        map_window_result(window.unmaximize(), WindowOperation::Unmaximize)?;
        Ok(false)
    } else {
        map_window_result(window.maximize(), WindowOperation::Maximize)?;
        Ok(true)
    }
}

/// Maps a native window failure to its safe public operation category.
fn map_window_result(
    result: tauri::Result<()>,
    operation: WindowOperation,
) -> Result<(), WindowOperation> {
    result.map_err(
        // Reports only the safe operation category until structured logging exists.
        |_source| {
            eprintln!("native window operation failed: {operation:?}");
            operation
        },
    )
}

/// Maps a value-returning native window failure to its safe operation category.
fn map_window_value<T>(
    result: tauri::Result<T>,
    operation: WindowOperation,
) -> Result<T, WindowOperation> {
    result.map_err(
        // Reports only the safe operation category until structured logging exists.
        |_source| {
            eprintln!("native window operation failed: {operation:?}");
            operation
        },
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{
        MainWindow, WindowOperation, bring_to_front, hide_window, minimize_window,
        toggle_window_maximized,
    };

    /// Records native operations and optionally fails one selected operation.
    struct RecordingWindow {
        calls: Mutex<Vec<WindowOperation>>,
        fail_on: Option<WindowOperation>,
        maximized: bool,
    }

    impl RecordingWindow {
        /// Creates a recording window with a stable initial maximized state.
        fn new(maximized: bool, fail_on: Option<WindowOperation>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail_on,
                maximized,
            }
        }

        /// Records one operation and returns the configured native failure.
        fn record(&self, operation: WindowOperation) -> tauri::Result<()> {
            self.calls
                .lock()
                .expect("the calls lock should be available")
                .push(operation);
            if self.fail_on == Some(operation) {
                Err(tauri::Error::Io(std::io::Error::other("fixture")))
            } else {
                Ok(())
            }
        }

        /// Returns a copy of the recorded operation sequence.
        fn calls(&self) -> Vec<WindowOperation> {
            self.calls
                .lock()
                .expect("the calls lock should be available")
                .clone()
        }
    }

    impl MainWindow for RecordingWindow {
        /// Records a show operation.
        fn show(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Show)
        }

        /// Records a hide operation.
        fn hide(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Hide)
        }

        /// Records an unminimize operation.
        fn unminimize(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Unminimize)
        }

        /// Records a focus operation.
        fn focus(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Focus)
        }

        /// Records a minimize operation.
        fn minimize(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Minimize)
        }

        /// Records the maximized-state read and returns its fixture value.
        fn is_maximized(&self) -> tauri::Result<bool> {
            self.record(WindowOperation::ReadMaximized)?;
            Ok(self.maximized)
        }

        /// Records a maximize operation.
        fn maximize(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Maximize)
        }

        /// Records an unmaximize operation.
        fn unmaximize(&self) -> tauri::Result<()> {
            self.record(WindowOperation::Unmaximize)
        }
    }

    /// Verifies that restore activation uses the required native call order.
    #[test]
    fn bring_to_front_uses_required_order() {
        let window = RecordingWindow::new(false, None);

        bring_to_front(&window).expect("the operations should succeed");

        assert_eq!(
            window.calls(),
            vec![
                WindowOperation::Show,
                WindowOperation::Unminimize,
                WindowOperation::Focus
            ]
        );
    }

    /// Verifies that activation stops and reports the exact failed operation.
    #[test]
    fn bring_to_front_maps_each_failure() {
        for operation in [
            WindowOperation::Show,
            WindowOperation::Unminimize,
            WindowOperation::Focus,
        ] {
            let window = RecordingWindow::new(false, Some(operation));
            assert_eq!(bring_to_front(&window), Err(operation));
        }
    }

    /// Verifies that maximize toggle returns the post-operation state.
    #[test]
    fn toggle_reports_the_new_maximized_state() {
        let restored = RecordingWindow::new(false, None);
        let maximized = RecordingWindow::new(true, None);

        assert_eq!(toggle_window_maximized(&restored), Ok(true));
        assert_eq!(
            restored.calls(),
            vec![WindowOperation::ReadMaximized, WindowOperation::Maximize]
        );
        assert_eq!(toggle_window_maximized(&maximized), Ok(false));
        assert_eq!(
            maximized.calls(),
            vec![WindowOperation::ReadMaximized, WindowOperation::Unmaximize]
        );
    }

    /// Verifies that minimize delegates exactly once.
    #[test]
    fn minimize_calls_native_operation_once() {
        let window = RecordingWindow::new(false, None);

        minimize_window(&window).expect("minimize should succeed");

        assert_eq!(window.calls(), vec![WindowOperation::Minimize]);
    }

    /// Verifies direct operations and all toggle failures preserve their category.
    #[test]
    fn direct_and_toggle_failures_map_exact_operations() {
        let hidden = RecordingWindow::new(false, Some(WindowOperation::Hide));
        let minimized = RecordingWindow::new(false, Some(WindowOperation::Minimize));
        assert_eq!(hide_window(&hidden), Err(WindowOperation::Hide));
        assert_eq!(minimize_window(&minimized), Err(WindowOperation::Minimize));

        for (maximized, operation) in [
            (false, WindowOperation::ReadMaximized),
            (false, WindowOperation::Maximize),
            (true, WindowOperation::Unmaximize),
        ] {
            let window = RecordingWindow::new(maximized, Some(operation));
            assert_eq!(toggle_window_maximized(&window), Err(operation));
        }
    }
}
