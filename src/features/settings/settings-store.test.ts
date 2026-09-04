import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsError } from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings } from "@/lib/ipc/settings";
import { classifySettingsFailure } from "./settings-error-copy";
import { resetSettingsStore, retainSettingsArea, useSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({ getSettings: vi.fn() }));

const getSettingsMock = vi.mocked(getSettings);

/** Create one promise whose settlement a test controls explicitly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Wrap one generated code as the normalized command failure the store receives. */
function settingsError(code: SettingsError["code"]): IpcCallError<SettingsError> {
  return new IpcCallError("get_settings", { code } as SettingsError);
}

describe("settings store", () => {
  // Give each test a clean store and command double.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset();
  });

  // Invalidate any promise left unsettled by a lifecycle test.
  afterEach(() => {
    resetSettingsStore();
  });

  // Verify a retained frame receives one complete snapshot and clears previous failure state.
  it("moves from idle through loading to ready", async () => {
    const pending = deferred<ReturnType<typeof createSettingsSnapshot>>();
    const release = retainSettingsArea();
    getSettingsMock.mockReturnValue(pending.promise);

    const load = useSettingsStore.getState().load();
    expect(useSettingsStore.getState()).toMatchObject({ status: "loading", snapshot: null });

    const snapshot = createSettingsSnapshot({ showTrayIcon: false });
    pending.resolve(snapshot);
    await load;

    expect(useSettingsStore.getState()).toMatchObject({
      status: "ready",
      snapshot,
      errorCode: null,
    });
    release();
  });

  // Verify repeated loads share exactly one command call while the first read is pending.
  it("deduplicates an in-flight read", async () => {
    const pending = deferred<ReturnType<typeof createSettingsSnapshot>>();
    const release = retainSettingsArea();
    getSettingsMock.mockReturnValue(pending.promise);

    const first = useSettingsStore.getState().load();
    const second = useSettingsStore.getState().load();
    expect(getSettingsMock).toHaveBeenCalledOnce();

    pending.resolve(createSettingsSnapshot());
    await Promise.all([first, second]);
    release();
  });

  // Verify retryable backend failures are retained until an explicit second load succeeds.
  it.each(["unavailable", "persistence_failed"] as const)(
    "retains and retries the %s failure",
    async (code) => {
      const release = retainSettingsArea();
      getSettingsMock.mockRejectedValueOnce(settingsError(code));

      await useSettingsStore.getState().load();
      expect(useSettingsStore.getState()).toMatchObject({ status: "error", errorCode: code });
      expect(classifySettingsFailure(code).kind).toBe("retryable");

      const snapshot = createSettingsSnapshot();
      getSettingsMock.mockResolvedValueOnce(snapshot);
      await useSettingsStore.getState().load();
      expect(useSettingsStore.getState()).toMatchObject({
        status: "ready",
        snapshot,
        errorCode: null,
      });
      release();
    },
  );

  // Verify every read-impossible generated code maps to a restart-only integration failure.
  it.each([
    "unauthorized_window",
    "empty_patch",
    "invalid_color",
    "contrast_too_low",
    "value_out_of_range",
    "invalid_preset_combination",
    "corrupt_stored_settings",
  ] as const)("classifies %s as a non-retryable integration failure", async (code) => {
    const release = retainSettingsArea();
    getSettingsMock.mockRejectedValue(settingsError(code));

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().errorCode).toBe(code);
    expect(classifySettingsFailure(code).kind).toBe("integration");
    release();
  });

  // Verify malformed and future error codes cannot masquerade as a known backend failure.
  it("classifies an unrecognized rejection as unknown", async () => {
    const release = retainSettingsArea();
    getSettingsMock.mockRejectedValue(new Error("transport"));

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().errorCode).toBe("unknown");
    expect(classifySettingsFailure("unknown").kind).toBe("integration");
    release();
  });

  // Verify the last frame leaving prevents a late response from entering retained state.
  it("discards a completion after the last frame releases", async () => {
    const pending = deferred<ReturnType<typeof createSettingsSnapshot>>();
    const release = retainSettingsArea();
    getSettingsMock.mockReturnValue(pending.promise);
    const load = useSettingsStore.getState().load();

    release();
    expect(useSettingsStore.getState().status).toBe("idle");
    pending.resolve(createSettingsSnapshot());
    await load;

    expect(useSettingsStore.getState()).toMatchObject({ status: "idle", snapshot: null });
  });

  // Verify an immediate development remount can adopt the pending read without calling again.
  it("shares a pending read across an immediate release and retain", async () => {
    const pending = deferred<ReturnType<typeof createSettingsSnapshot>>();
    const firstRelease = retainSettingsArea();
    getSettingsMock.mockReturnValue(pending.promise);
    const first = useSettingsStore.getState().load();

    firstRelease();
    const secondRelease = retainSettingsArea();
    const second = useSettingsStore.getState().load();
    pending.resolve(createSettingsSnapshot());
    await Promise.all([first, second]);

    expect(getSettingsMock).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().status).toBe("ready");
    secondRelease();
  });

  // Verify reset invalidates an older completion and restores documented defaults.
  it("ignores an old completion after reset", async () => {
    const pending = deferred<ReturnType<typeof createSettingsSnapshot>>();
    retainSettingsArea();
    getSettingsMock.mockReturnValue(pending.promise);
    const load = useSettingsStore.getState().load();

    resetSettingsStore();
    pending.resolve(createSettingsSnapshot());
    await load;

    expect(useSettingsStore.getState()).toMatchObject({
      status: "idle",
      snapshot: null,
      errorCode: null,
    });
  });
});
