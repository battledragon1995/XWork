import { invoke } from "@tauri-apps/api/core";
import { type Event, listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import type { QuickNoteGlobalShortcutStatusDto } from "@/bindings/quick-note-window";
import { IpcCallError } from "./ipc-error";
import * as ipc from "./quick-note-window";

/** Isolate native command execution. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Isolate native event subscriptions. */
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
/** Clear transport history between contracts. */
beforeEach(() => vi.resetAllMocks());
/** Preserve exact no-argument command names. */
it("forwards the four BE017 commands", async () => {
  for (const [name, call] of [
    ["open_quick_note_window", ipc.openQuickNoteWindow],
    ["close_quick_note_window", ipc.closeQuickNoteWindow],
    ["start_quick_note_window_drag", ipc.startQuickNoteWindowDrag],
    ["get_quick_note_global_shortcut_status", ipc.getQuickNoteGlobalShortcutStatus],
  ] as const) {
    await call();
    expect(invoke).toHaveBeenLastCalledWith(name, undefined);
  }
});
/** Return native cleanup and payload without coercing decimal sequence. */
it("forwards status events and unsubscription", async () => {
  const stop = vi.fn();
  vi.mocked(listen).mockResolvedValue(stop);
  const handler = vi.fn();
  expect(await ipc.onQuickNoteGlobalShortcutStatusChanged(handler)).toBe(stop);
  expect(listen).toHaveBeenCalledWith(
    "quick-note://global-shortcut-status-changed",
    expect.any(Function),
  );
  const payload = { sequence: "9007199254740993" } as QuickNoteGlobalShortcutStatusDto;
  const callback = vi.mocked(listen).mock.calls[0][1] as (
    event: Event<QuickNoteGlobalShortcutStatusDto>,
  ) => void;
  callback({ payload } as Event<QuickNoteGlobalShortcutStatusDto>);
  expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
});
/** Keep backend errors typed and unknown transport errors opaque. */
it("normalizes rejected commands", async () => {
  vi.mocked(invoke).mockRejectedValueOnce({ code: "stale_window" });
  await expect(ipc.closeQuickNoteWindow()).rejects.toMatchObject({
    payload: { code: "stale_window" },
  });
  vi.mocked(invoke).mockRejectedValueOnce("private native error");
  await expect(ipc.openQuickNoteWindow()).rejects.toEqual(
    new IpcCallError("open_quick_note_window", null),
  );
});
