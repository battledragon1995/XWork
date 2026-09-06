import { beforeEach, expect, it, vi } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import { readAppInfo } from "@/lib/ipc/app-info";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/keyboard-shortcuts";
import { createKeyboardShortcutsState } from "./keyboard-shortcuts-state";

/** Replace every native boundary with isolated promises. */
vi.mock("@/lib/ipc/keyboard-shortcuts", () => ({
  getKeyboardShortcuts: vi.fn(),
  setKeyboardShortcut: vi.fn(),
  resetKeyboardShortcut: vi.fn(),
  resetAllKeyboardShortcuts: vi.fn(),
}));
/** Platform is explicit test data. */
vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));
const chord = { primary: true, alt: false, shift: false, keyCode: "KeyT" };
const snapshot: KeyboardShortcutsDto = {
  actions: [
    {
      actionId: "tabs.create",
      label: "New tab",
      category: "tabs",
      scope: "application",
      defaultChord: chord,
      currentChord: chord,
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
  ],
};
/** Expose settlement so ordering assertions do not depend on timers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>(
    // Capture test-controlled resolution without global state.
    (yes, no) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}
/** Reset mocks before creating each independent coordinator. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readAppInfo).mockResolvedValue({
    osPlatform: "windows",
    osArch: "x64",
    osVersion: "test",
    appVersion: "test",
  });
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(snapshot);
});
/** A write publishes only its committed result and blocks a second mutation. */
it("serializes mutations and coalesces trailing refresh", async () => {
  const store = createKeyboardShortcutsState();
  await store.getSnapshot().refresh();
  const write = deferred<KeyboardShortcutsDto>();
  vi.mocked(ipc.setKeyboardShortcut).mockReturnValue(write.promise);
  const changed = structuredClone(snapshot);
  const target = changed.actions[0];
  if (target === undefined) throw new Error("Expected fixture action");
  target.currentChord.keyCode = "KeyY";
  const pending = store.getSnapshot().assign({ actionId: "tabs.create", chord });
  expect(store.getSnapshot().snapshot).toBe(snapshot);
  expect(await store.getSnapshot().resetAll()).toBe(false);
  const focus1 = store.getSnapshot().refresh();
  const focus2 = store.getSnapshot().refresh();
  await Promise.resolve();
  expect(ipc.getKeyboardShortcuts).toHaveBeenCalledTimes(1);
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(changed);
  write.resolve(changed);
  expect(await pending).toBe(true);
  await Promise.all([focus1, focus2]);
  expect(store.getSnapshot().snapshot).toBe(changed);
  expect(ipc.getKeyboardShortcuts).toHaveBeenCalledTimes(2);
});
/** Reads cannot race a later mutation or overwrite its acknowledged commit. */
it("blocks writes during a coalesced read", async () => {
  const store = createKeyboardShortcutsState();
  const read = deferred<KeyboardShortcutsDto>();
  vi.mocked(ipc.getKeyboardShortcuts).mockReturnValue(read.promise);
  const first = store.getSnapshot().refresh();
  expect(store.getSnapshot().refresh()).toBe(first);
  expect(await store.getSnapshot().assign({ actionId: "tabs.create", chord })).toBe(false);
  read.resolve(snapshot);
  await first;
  expect(store.getSnapshot().status).toBe("ready");
  expect(ipc.setKeyboardShortcut).not.toHaveBeenCalled();
});
/** Known persistence failure preserves the old snapshot and allows explicit retry. */
it("retains committed state on persistence rejection", async () => {
  const store = createKeyboardShortcutsState();
  await store.getSnapshot().refresh();
  vi.mocked(ipc.resetAllKeyboardShortcuts).mockRejectedValue(
    new IpcCallError("reset_all_keyboard_shortcuts", { code: "persistence_failed" }),
  );
  expect(await store.getSnapshot().resetAll()).toBe(false);
  expect(store.getSnapshot().snapshot).toBe(snapshot);
  expect(store.getSnapshot().status).toBe("ready");
});
/** Transport, future errors and unavailable outcomes require a successful read before retry. */
it.each([null, { code: "future_error" }, { code: "unavailable" }])(
  "reconciles unknown commit outcomes %j",
  async (payload) => {
    const store = createKeyboardShortcutsState();
    await store.getSnapshot().refresh();
    vi.mocked(ipc.resetAllKeyboardShortcuts).mockRejectedValue(
      new IpcCallError("reset_all_keyboard_shortcuts", payload),
    );
    expect(await store.getSnapshot().resetAll()).toBe(false);
    expect(store.getSnapshot().status).toBe("error");
    expect(await store.getSnapshot().resetAll()).toBe(false);
    expect(ipc.resetAllKeyboardShortcuts).toHaveBeenCalledTimes(1);
    await store.getSnapshot().refresh();
    expect(store.getSnapshot().status).toBe("ready");
  },
);
/** Startup failures are recoverable without fabricating a platform or defaults. */
it.each(["platform", "catalog"])("recovers a %s startup failure", async (source) => {
  if (source === "platform") vi.mocked(readAppInfo).mockRejectedValueOnce(new Error("offline"));
  else vi.mocked(ipc.getKeyboardShortcuts).mockRejectedValueOnce(new Error("offline"));
  const store = createKeyboardShortcutsState();
  await store.getSnapshot().refresh();
  expect(store.getSnapshot().status).toBe("error");
  expect(await store.getSnapshot().resetAll()).toBe(false);
  await store.getSnapshot().refresh();
  expect(store.getSnapshot().status).toBe("ready");
});
/** Disposed provider generations cannot publish a late backend result. */
it("ignores a completed mutation after disposal", async () => {
  const store = createKeyboardShortcutsState();
  await store.getSnapshot().refresh();
  const write = deferred<KeyboardShortcutsDto>();
  vi.mocked(ipc.resetAllKeyboardShortcuts).mockReturnValue(write.promise);
  const listener = vi.fn();
  store.subscribe(listener);
  const pending = store.getSnapshot().resetAll();
  await Promise.resolve();
  store.dispose();
  listener.mockClear();
  write.resolve(snapshot);
  expect(await pending).toBe(false);
  expect(listener).not.toHaveBeenCalled();
});
