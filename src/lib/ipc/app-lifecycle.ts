import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppLifecycleError,
  QuitRequestDto,
  SessionNavigationDto,
} from "@/bindings/app-lifecycle";
import { invokeCommand } from "./ipc-error";

/** Re-exported so shell code can type a subscription without importing Tauri directly. */
export type { UnlistenFn };

/** Event the backend emits when a tray Quit needs frontend confirmation. */
const QUIT_REQUESTED_EVENT = "app-quit-requested";
/** Event the backend emits when a tray entry should open one session. */
const NAVIGATE_SESSION_EVENT = "app-navigate-session";

// Call one lifecycle command with the shared error normalization of this layer.
function invokeLifecycle<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, AppLifecycleError>(command, args);
}

// Hide the main window to the tray. Sessions, processes and any pending quit request survive.
export function hideMainWindow(): Promise<void> {
  return invokeLifecycle<void>("hide_main_window");
}

// Minimize the main window without changing any runtime state.
export function minimizeMainWindow(): Promise<void> {
  return invokeLifecycle<void>("minimize_main_window");
}

// Toggle the main window between maximized and restored, returning the resulting native state.
export function toggleMainWindowMaximized(): Promise<boolean> {
  return invokeLifecycle<boolean>("toggle_main_window_maximized");
}

// Ask the backend to quit. A `null` result means the backend already exited on its own.
export function requestQuit(): Promise<QuitRequestDto | null> {
  return invokeLifecycle<QuitRequestDto | null>("request_quit");
}

// Drop one pending quit request. Tauri maps `requestId` to the Rust `request_id` parameter.
export function cancelQuit(requestId: number): Promise<void> {
  return invokeLifecycle<void>("cancel_quit", { requestId });
}

// Confirm one pending quit request and let the backend shut the runtime down.
export function confirmQuit(requestId: number): Promise<void> {
  return invokeLifecycle<void>("confirm_quit", { requestId });
}

// Subscribe to tray-initiated quit requests. The returned callback removes the listener.
export function onQuitRequested(handler: (request: QuitRequestDto) => void): Promise<UnlistenFn> {
  return listen<QuitRequestDto>(QUIT_REQUESTED_EVENT, (event: Event<QuitRequestDto>) => {
    handler(event.payload);
  });
}

// Subscribe to tray-initiated session navigation. The returned callback removes the listener.
export function onNavigateSession(
  handler: (target: SessionNavigationDto) => void,
): Promise<UnlistenFn> {
  return listen<SessionNavigationDto>(
    NAVIGATE_SESSION_EVENT,
    (event: Event<SessionNavigationDto>) => {
      handler(event.payload);
    },
  );
}
