import type {
  KeyboardShortcutsDto,
  KeyboardShortcutsError,
  SetKeyboardShortcutInputDto,
} from "@/bindings/keyboard-shortcuts";
import { readAppInfo } from "@/lib/ipc/app-info";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  getKeyboardShortcuts,
  resetAllKeyboardShortcuts,
  resetKeyboardShortcut,
  setKeyboardShortcut,
} from "@/lib/ipc/keyboard-shortcuts";
import type { ShortcutPlatform } from "@/lib/utils/keyboard-shortcuts";

/** Retain only committed backend data and transient request state. */
export interface KeyboardShortcutsState {
  snapshot: KeyboardShortcutsDto | null;
  platform: ShortcutPlatform | null;
  status: "idle" | "loading" | "ready" | "refreshing" | "error";
  pending: "set" | "resetOne" | "resetAll" | null;
  error: IpcCallError<KeyboardShortcutsError> | null;
  /** Reconcile with the backend before accepting writes. */
  refresh(): Promise<void>;
  /** Commit an assignment. */
  assign(input: SetKeyboardShortcutInputDto): Promise<boolean>;
  /** Restore an action. */
  resetOne(actionId: string): Promise<boolean>;
  /** Restore the entire catalog. */
  resetAll(): Promise<boolean>;
}
/** Convert every unexpected rejection into an uncertainty marker. */
function failure(error: unknown): IpcCallError<KeyboardShortcutsError> {
  return error instanceof IpcCallError
    ? (error as IpcCallError<KeyboardShortcutsError>)
    : new IpcCallError<KeyboardShortcutsError>("keyboard_shortcuts", null);
}
/** Explain failures without exposing backend diagnostics. */
export function shortcutErrorCopy(
  error: IpcCallError<KeyboardShortcutsError> | null,
  platform: ShortcutPlatform | null,
): string | null {
  if (error === null) return null;
  switch (error.payload?.code) {
    case "invalid_key_code":
      return "This key is not supported.";
    case "modifier_required":
      return platform === "macos"
        ? "Use Command or Option, or a function key."
        : "Use Ctrl or Alt, or a function key.";
    case "reserved_shortcut":
      return "This shortcut is reserved by the operating system.";
    case "action_not_found":
      return "This action is no longer available.";
    case "persistence_failed":
      return "Could not save keyboard shortcuts. Try again.";
    case "unavailable":
      return "Keyboard shortcuts are temporarily unavailable.";
    case "unauthorized_window":
      return "Keyboard shortcuts can only be changed in the main window.";
    case "corrupt_stored_shortcut":
      return "Keyboard shortcut data could not be loaded. Restart XWork or contact support.";
    default:
      return "Could not confirm the shortcut change. Reload shortcuts before trying again.";
  }
}
/** Create a coordinator private to one provider lifetime, with no persistent singleton. */
export function createKeyboardShortcutsState() {
  const listeners = new Set<() => void>();
  let disposed = false;
  let reading: Promise<void> | null = null;
  let writing: Promise<boolean> | null = null;
  let focusQueued = false;
  let state: KeyboardShortcutsState = {
    snapshot: null,
    platform: null,
    status: "idle",
    pending: null,
    error: null,
    refresh,
    assign,
    resetOne,
    resetAll,
  };
  /** Publish atomically unless this lifetime has been disposed. */
  function publish(patch: Partial<KeyboardShortcutsState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  /** Coalesce reads, deferring a focus refresh until an in-flight write settles. */
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (writing !== null) {
      focusQueued = true;
      // Await the write and its single trailing reconciliation.
      return writing.then(async () => {
        if (reading !== null) await reading;
      });
    }
    if (reading !== null) return reading;
    publish({ status: state.snapshot === null ? "loading" : "refreshing", error: null });
    // Schedule IPC after the promise slot is installed, including synchronous test failures.
    reading = Promise.resolve().then(async () => {
      try {
        if (disposed) return;
        const platform = state.platform ?? (await readAppInfo()).osPlatform;
        if (platform !== "windows" && platform !== "macos") throw new Error("Unsupported platform");
        if (disposed) return;
        publish({ platform });
        const snapshot = await getKeyboardShortcuts();
        publish({ platform, snapshot, status: "ready", error: null });
      } catch (error) {
        publish({ status: "error", error: failure(error) });
      } finally {
        reading = null;
      }
    });
    return reading;
  }
  /** Reject concurrent writes and publish only a returned committed snapshot. */
  function mutate(
    pending: NonNullable<KeyboardShortcutsState["pending"]>,
    operation: () => Promise<KeyboardShortcutsDto>,
  ): Promise<boolean> {
    if (
      disposed ||
      reading !== null ||
      writing !== null ||
      state.status !== "ready" ||
      state.platform === null ||
      !state.snapshot?.actions.length
    )
      return Promise.resolve(false);
    publish({ pending, error: null });
    // Run the single admitted mutation after installing its promise slot.
    writing = Promise.resolve().then(async () => {
      try {
        const snapshot = await operation();
        publish({ snapshot });
        return !disposed;
      } catch (error) {
        const parsed = failure(error);
        const known = [
          "invalid_key_code",
          "modifier_required",
          "reserved_shortcut",
          "action_not_found",
          "persistence_failed",
          "unauthorized_window",
        ].includes(parsed.payload?.code ?? "");
        publish({ error: parsed, status: known ? "ready" : "error" });
        return false;
      } finally {
        writing = null;
        publish({ pending: null });
        if (focusQueued) {
          focusQueued = false;
          void refresh();
        }
      }
    });
    return writing;
  }
  /** Submit one assignment without optimistic updates. */
  function assign(input: SetKeyboardShortcutInputDto) {
    return mutate("set", /** Send the admitted assignment. */ () => setKeyboardShortcut(input));
  }
  /** Submit one reset through the same write gate. */
  function resetOne(actionId: string) {
    return mutate(
      "resetOne",
      /** Send the admitted action reset. */ () => resetKeyboardShortcut(actionId),
    );
  }
  /** Send restore-all even if no visible row is custom. */
  function resetAll() {
    return mutate("resetAll", resetAllKeyboardShortcuts);
  }
  return {
    /** Read the stable external-store snapshot. */
    getSnapshot: () => state,
    /** Subscribe one mounted React consumer. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      /** Release this external-store subscriber. */
      return () => {
        listeners.delete(listener);
      };
    },
    /** Release listeners and prevent stale responses from publishing. */
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
