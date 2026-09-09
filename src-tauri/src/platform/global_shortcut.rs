//! Converts canonical physical key codes and owns native shortcut registration.

use std::sync::Arc;

use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Represents the complete canonical physical-key allowlist accepted by the application.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlatformShortcutCode {
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    PageUp,
    PageDown,
    Home,
    End,
    Insert,
    Delete,
    Backspace,
    Enter,
    Escape,
    Space,
    Tab,
    Backslash,
    BracketLeft,
    BracketRight,
    Minus,
    Equal,
    Comma,
    Period,
    Slash,
    Semicolon,
    Quote,
    Backquote,
}

impl TryFrom<&str> for PlatformShortcutCode {
    type Error = GlobalShortcutPlatformError;

    /// Rejects aliases and incorrect casing before crossing the native boundary.
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "KeyA" => Ok(Self::KeyA),
            "KeyB" => Ok(Self::KeyB),
            "KeyC" => Ok(Self::KeyC),
            "KeyD" => Ok(Self::KeyD),
            "KeyE" => Ok(Self::KeyE),
            "KeyF" => Ok(Self::KeyF),
            "KeyG" => Ok(Self::KeyG),
            "KeyH" => Ok(Self::KeyH),
            "KeyI" => Ok(Self::KeyI),
            "KeyJ" => Ok(Self::KeyJ),
            "KeyK" => Ok(Self::KeyK),
            "KeyL" => Ok(Self::KeyL),
            "KeyM" => Ok(Self::KeyM),
            "KeyN" => Ok(Self::KeyN),
            "KeyO" => Ok(Self::KeyO),
            "KeyP" => Ok(Self::KeyP),
            "KeyQ" => Ok(Self::KeyQ),
            "KeyR" => Ok(Self::KeyR),
            "KeyS" => Ok(Self::KeyS),
            "KeyT" => Ok(Self::KeyT),
            "KeyU" => Ok(Self::KeyU),
            "KeyV" => Ok(Self::KeyV),
            "KeyW" => Ok(Self::KeyW),
            "KeyX" => Ok(Self::KeyX),
            "KeyY" => Ok(Self::KeyY),
            "KeyZ" => Ok(Self::KeyZ),
            "Digit0" => Ok(Self::Digit0),
            "Digit1" => Ok(Self::Digit1),
            "Digit2" => Ok(Self::Digit2),
            "Digit3" => Ok(Self::Digit3),
            "Digit4" => Ok(Self::Digit4),
            "Digit5" => Ok(Self::Digit5),
            "Digit6" => Ok(Self::Digit6),
            "Digit7" => Ok(Self::Digit7),
            "Digit8" => Ok(Self::Digit8),
            "Digit9" => Ok(Self::Digit9),
            "F1" => Ok(Self::F1),
            "F2" => Ok(Self::F2),
            "F3" => Ok(Self::F3),
            "F4" => Ok(Self::F4),
            "F5" => Ok(Self::F5),
            "F6" => Ok(Self::F6),
            "F7" => Ok(Self::F7),
            "F8" => Ok(Self::F8),
            "F9" => Ok(Self::F9),
            "F10" => Ok(Self::F10),
            "F11" => Ok(Self::F11),
            "F12" => Ok(Self::F12),
            "ArrowUp" => Ok(Self::ArrowUp),
            "ArrowDown" => Ok(Self::ArrowDown),
            "ArrowLeft" => Ok(Self::ArrowLeft),
            "ArrowRight" => Ok(Self::ArrowRight),
            "PageUp" => Ok(Self::PageUp),
            "PageDown" => Ok(Self::PageDown),
            "Home" => Ok(Self::Home),
            "End" => Ok(Self::End),
            "Insert" => Ok(Self::Insert),
            "Delete" => Ok(Self::Delete),
            "Backspace" => Ok(Self::Backspace),
            "Enter" => Ok(Self::Enter),
            "Escape" => Ok(Self::Escape),
            "Space" => Ok(Self::Space),
            "Tab" => Ok(Self::Tab),
            "Backslash" => Ok(Self::Backslash),
            "BracketLeft" => Ok(Self::BracketLeft),
            "BracketRight" => Ok(Self::BracketRight),
            "Minus" => Ok(Self::Minus),
            "Equal" => Ok(Self::Equal),
            "Comma" => Ok(Self::Comma),
            "Period" => Ok(Self::Period),
            "Slash" => Ok(Self::Slash),
            "Semicolon" => Ok(Self::Semicolon),
            "Quote" => Ok(Self::Quote),
            "Backquote" => Ok(Self::Backquote),
            _ => Err(GlobalShortcutPlatformError::InvalidKeyCode),
        }
    }
}

impl PlatformShortcutCode {
    /// Maps every supported physical key explicitly to its native equivalent.
    fn native(self) -> Code {
        match self {
            Self::KeyA => Code::KeyA,
            Self::KeyB => Code::KeyB,
            Self::KeyC => Code::KeyC,
            Self::KeyD => Code::KeyD,
            Self::KeyE => Code::KeyE,
            Self::KeyF => Code::KeyF,
            Self::KeyG => Code::KeyG,
            Self::KeyH => Code::KeyH,
            Self::KeyI => Code::KeyI,
            Self::KeyJ => Code::KeyJ,
            Self::KeyK => Code::KeyK,
            Self::KeyL => Code::KeyL,
            Self::KeyM => Code::KeyM,
            Self::KeyN => Code::KeyN,
            Self::KeyO => Code::KeyO,
            Self::KeyP => Code::KeyP,
            Self::KeyQ => Code::KeyQ,
            Self::KeyR => Code::KeyR,
            Self::KeyS => Code::KeyS,
            Self::KeyT => Code::KeyT,
            Self::KeyU => Code::KeyU,
            Self::KeyV => Code::KeyV,
            Self::KeyW => Code::KeyW,
            Self::KeyX => Code::KeyX,
            Self::KeyY => Code::KeyY,
            Self::KeyZ => Code::KeyZ,
            Self::Digit0 => Code::Digit0,
            Self::Digit1 => Code::Digit1,
            Self::Digit2 => Code::Digit2,
            Self::Digit3 => Code::Digit3,
            Self::Digit4 => Code::Digit4,
            Self::Digit5 => Code::Digit5,
            Self::Digit6 => Code::Digit6,
            Self::Digit7 => Code::Digit7,
            Self::Digit8 => Code::Digit8,
            Self::Digit9 => Code::Digit9,
            Self::F1 => Code::F1,
            Self::F2 => Code::F2,
            Self::F3 => Code::F3,
            Self::F4 => Code::F4,
            Self::F5 => Code::F5,
            Self::F6 => Code::F6,
            Self::F7 => Code::F7,
            Self::F8 => Code::F8,
            Self::F9 => Code::F9,
            Self::F10 => Code::F10,
            Self::F11 => Code::F11,
            Self::F12 => Code::F12,
            Self::ArrowUp => Code::ArrowUp,
            Self::ArrowDown => Code::ArrowDown,
            Self::ArrowLeft => Code::ArrowLeft,
            Self::ArrowRight => Code::ArrowRight,
            Self::PageUp => Code::PageUp,
            Self::PageDown => Code::PageDown,
            Self::Home => Code::Home,
            Self::End => Code::End,
            Self::Insert => Code::Insert,
            Self::Delete => Code::Delete,
            Self::Backspace => Code::Backspace,
            Self::Enter => Code::Enter,
            Self::Escape => Code::Escape,
            Self::Space => Code::Space,
            Self::Tab => Code::Tab,
            Self::Backslash => Code::Backslash,
            Self::BracketLeft => Code::BracketLeft,
            Self::BracketRight => Code::BracketRight,
            Self::Minus => Code::Minus,
            Self::Equal => Code::Equal,
            Self::Comma => Code::Comma,
            Self::Period => Code::Period,
            Self::Slash => Code::Slash,
            Self::Semicolon => Code::Semicolon,
            Self::Quote => Code::Quote,
            Self::Backquote => Code::Backquote,
        }
    }
}

/// Carries only normalized modifier flags and an approved physical key.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct PlatformShortcut {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: PlatformShortcutCode,
}

impl PlatformShortcut {
    /// Converts the primary modifier according to the target operating system.
    pub fn native(&self) -> Shortcut {
        let mut modifiers = Modifiers::empty();
        if self.primary {
            #[cfg(target_os = "macos")]
            modifiers.insert(Modifiers::SUPER);
            #[cfg(not(target_os = "macos"))]
            modifiers.insert(Modifiers::CONTROL);
        }
        if self.alt {
            modifiers.insert(Modifiers::ALT);
        }
        if self.shift {
            modifiers.insert(Modifiers::SHIFT);
        }
        Shortcut::new(Some(modifiers), self.key_code.native())
    }
}

/// Keeps platform failures free of raw native diagnostic details.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlobalShortcutPlatformError {
    InvalidKeyCode,
    RegistrationFailed,
    UnregistrationFailed,
}

/// Provides a native-registration seam without application policy.
#[doc(hidden)]
pub trait GlobalShortcutPlatform: Send + Sync {
    /// Registers a shortcut and forwards pressed or released state to its owner.
    fn register(
        &self,
        shortcut: &PlatformShortcut,
        callback: Arc<dyn Fn(bool) + Send + Sync>,
    ) -> Result<(), GlobalShortcutPlatformError>;

    /// Unregisters one shortcut previously requested by this process.
    fn unregister(&self, shortcut: &PlatformShortcut) -> Result<(), GlobalShortcutPlatformError>;
}

/// Delegates process-owned registrations to the initialized Rust plugin.
#[doc(hidden)]
pub struct NativeGlobalShortcutPlatform<R: Runtime>(AppHandle<R>);

impl<R: Runtime> NativeGlobalShortcutPlatform<R> {
    /// Retains the app handle whose composition root installed the plugin.
    pub fn new(app: AppHandle<R>) -> Self {
        Self(app)
    }
}

impl<R: Runtime> GlobalShortcutPlatform for NativeGlobalShortcutPlatform<R> {
    /// Attaches the caller's generation-bound callback to this exact registration.
    fn register(
        &self,
        shortcut: &PlatformShortcut,
        callback: Arc<dyn Fn(bool) + Send + Sync>,
    ) -> Result<(), GlobalShortcutPlatformError> {
        self.0
            .global_shortcut()
            // Preserve release events so the owner can reset its pressed-state latch.
            .on_shortcut(shortcut.native(), move |_, _, event| {
                callback(event.state == ShortcutState::Pressed);
            })
            // Sanitize native failures before returning to the owner.
            .map_err(|_| GlobalShortcutPlatformError::RegistrationFailed)
    }

    /// Removes this process's registration through the native plugin.
    fn unregister(&self, shortcut: &PlatformShortcut) -> Result<(), GlobalShortcutPlatformError> {
        self.0
            .global_shortcut()
            .unregister(shortcut.native())
            // Sanitize native failures before returning to the owner.
            .map_err(|_| GlobalShortcutPlatformError::UnregistrationFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Checks the complete allowlist against independently named native key variants.
    #[test]
    fn converts_every_allowed_physical_key() {
        let cases = [
            ("KeyA", Code::KeyA),
            ("KeyB", Code::KeyB),
            ("KeyC", Code::KeyC),
            ("KeyD", Code::KeyD),
            ("KeyE", Code::KeyE),
            ("KeyF", Code::KeyF),
            ("KeyG", Code::KeyG),
            ("KeyH", Code::KeyH),
            ("KeyI", Code::KeyI),
            ("KeyJ", Code::KeyJ),
            ("KeyK", Code::KeyK),
            ("KeyL", Code::KeyL),
            ("KeyM", Code::KeyM),
            ("KeyN", Code::KeyN),
            ("KeyO", Code::KeyO),
            ("KeyP", Code::KeyP),
            ("KeyQ", Code::KeyQ),
            ("KeyR", Code::KeyR),
            ("KeyS", Code::KeyS),
            ("KeyT", Code::KeyT),
            ("KeyU", Code::KeyU),
            ("KeyV", Code::KeyV),
            ("KeyW", Code::KeyW),
            ("KeyX", Code::KeyX),
            ("KeyY", Code::KeyY),
            ("KeyZ", Code::KeyZ),
            ("Digit0", Code::Digit0),
            ("Digit1", Code::Digit1),
            ("Digit2", Code::Digit2),
            ("Digit3", Code::Digit3),
            ("Digit4", Code::Digit4),
            ("Digit5", Code::Digit5),
            ("Digit6", Code::Digit6),
            ("Digit7", Code::Digit7),
            ("Digit8", Code::Digit8),
            ("Digit9", Code::Digit9),
            ("F1", Code::F1),
            ("F2", Code::F2),
            ("F3", Code::F3),
            ("F4", Code::F4),
            ("F5", Code::F5),
            ("F6", Code::F6),
            ("F7", Code::F7),
            ("F8", Code::F8),
            ("F9", Code::F9),
            ("F10", Code::F10),
            ("F11", Code::F11),
            ("F12", Code::F12),
            ("ArrowUp", Code::ArrowUp),
            ("ArrowDown", Code::ArrowDown),
            ("ArrowLeft", Code::ArrowLeft),
            ("ArrowRight", Code::ArrowRight),
            ("PageUp", Code::PageUp),
            ("PageDown", Code::PageDown),
            ("Home", Code::Home),
            ("End", Code::End),
            ("Insert", Code::Insert),
            ("Delete", Code::Delete),
            ("Backspace", Code::Backspace),
            ("Enter", Code::Enter),
            ("Escape", Code::Escape),
            ("Space", Code::Space),
            ("Tab", Code::Tab),
            ("Backslash", Code::Backslash),
            ("BracketLeft", Code::BracketLeft),
            ("BracketRight", Code::BracketRight),
            ("Minus", Code::Minus),
            ("Equal", Code::Equal),
            ("Comma", Code::Comma),
            ("Period", Code::Period),
            ("Slash", Code::Slash),
            ("Semicolon", Code::Semicolon),
            ("Quote", Code::Quote),
            ("Backquote", Code::Backquote),
        ];
        for (canonical, native) in cases {
            let code = PlatformShortcutCode::try_from(canonical).unwrap();
            assert_eq!(code.native(), native, "{canonical}");
            assert_eq!(
                PlatformShortcutCode::try_from(canonical.to_lowercase().as_str()),
                Err(GlobalShortcutPlatformError::InvalidKeyCode),
                "{canonical}"
            );
        }
    }

    /// Rejects unsupported keys, plugin aliases, whitespace, and malformed canonical names.
    #[test]
    fn rejects_noncanonical_and_unsupported_codes() {
        for value in [
            "",
            "A",
            "1",
            "Keya",
            "keyA",
            "Digit10",
            "F0",
            "F13",
            "Enter ",
            " Enter",
            "Esc",
            "Spacebar",
            "Numpad0",
            "ControlLeft",
            "MetaLeft",
            "MediaPlayPause",
            "IntlBackslash",
        ] {
            assert_eq!(
                PlatformShortcutCode::try_from(value),
                Err(GlobalShortcutPlatformError::InvalidKeyCode),
                "{value}"
            );
        }
    }

    /// Checks every modifier combination without registering an operating-system shortcut.
    #[test]
    fn maps_all_modifier_combinations() {
        for primary in [false, true] {
            for alt in [false, true] {
                for shift in [false, true] {
                    let shortcut = PlatformShortcut {
                        primary,
                        alt,
                        shift,
                        key_code: PlatformShortcutCode::KeyN,
                    };
                    let mut expected = Modifiers::empty();
                    if primary {
                        #[cfg(target_os = "macos")]
                        expected.insert(Modifiers::SUPER);
                        #[cfg(not(target_os = "macos"))]
                        expected.insert(Modifiers::CONTROL);
                    }
                    if alt {
                        expected.insert(Modifiers::ALT);
                    }
                    if shift {
                        expected.insert(Modifiers::SHIFT);
                    }
                    assert_eq!(shortcut.native(), Shortcut::new(Some(expected), Code::KeyN));
                }
            }
        }
    }
}
