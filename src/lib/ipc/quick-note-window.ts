import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  QuickNoteGlobalShortcutStatusDto,
  QuickNoteWindowError,
} from "@/bindings/quick-note-window";
import { invokeCommand } from "./ipc-error";
/** Ask Rust to open or focus the singleton capture window. */
export function openQuickNoteWindow() {
  return invokeCommand<void, QuickNoteWindowError>("open_quick_note_window");
}
/** Close only the calling floating instance. */
export function closeQuickNoteWindow() {
  return invokeCommand<void, QuickNoteWindowError>("close_quick_note_window");
}
/** Delegate native dragging to the calling window's backend owner. */
export function startQuickNoteWindowDrag() {
  return invokeCommand<void, QuickNoteWindowError>("start_quick_note_window_drag");
}
/** Read the main-only OS registration snapshot. */
export function getQuickNoteGlobalShortcutStatus() {
  return invokeCommand<QuickNoteGlobalShortcutStatusDto, QuickNoteWindowError>(
    "get_quick_note_global_shortcut_status",
  );
}
/** Forward only the public shortcut reconciliation payload. */
export function onQuickNoteGlobalShortcutStatusChanged(
  handler: (event: QuickNoteGlobalShortcutStatusDto) => void,
): Promise<UnlistenFn> {
  return listen<QuickNoteGlobalShortcutStatusDto>(
    "quick-note://global-shortcut-status-changed",
    /** Strip the native event envelope. */ (event) => handler(event.payload),
  );
}
