import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsDto, SettingsError } from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings, restoreAppearanceDefaults, updateSettings } from "@/lib/ipc/settings";
import { classifySettingsFailure, classifySettingsSaveFailure } from "./settings-error-copy";
import {
  bootstrapAppSettings,
  resetSettingsStore,
  retainSettingsArea,
  useSettingsStore,
} from "./settings-store";
import { createAppearanceSettings, createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const updateSettingsMock = vi.mocked(updateSettings);
const restoreAppearanceDefaultsMock = vi.mocked(restoreAppearanceDefaults);

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

/** Wrap one complete generated error payload as the failure a write command produces. */
function saveError(payload: SettingsError): IpcCallError<SettingsError> {
  return new IpcCallError("update_settings", payload);
}

describe("settings store", () => {
  // Give each test a clean store and command double.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    restoreAppearanceDefaultsMock.mockReset();
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

describe("appearance draft and mutation queue", () => {
  // Give each test a clean store, command doubles, and one ready snapshot to edit.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    restoreAppearanceDefaultsMock.mockReset();
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
  });

  // Invalidate any promise left unsettled by a queue test.
  afterEach(() => {
    resetSettingsStore();
  });

  // Verify a preview is purely local so live preview costs no backend round trip.
  it("previews without calling any command", () => {
    const draft = createAppearanceSettings({ themeMode: "dark" });

    useSettingsStore.getState().previewAppearance(draft);

    expect(useSettingsStore.getState().appearanceDraft).toBe(draft);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(restoreAppearanceDefaultsMock).not.toHaveBeenCalled();
  });

  // Verify one commit sends exactly the Appearance section and no sidebar payload.
  it("sends one appearance-only update payload", async () => {
    updateSettingsMock.mockResolvedValue(createSettingsSnapshot());

    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    expect(updateSettingsMock).toHaveBeenCalledWith({ appearance: { themeMode: "dark" } });
  });

  // Verify a patch with no field never reaches the backend, which would reject it.
  it("refuses to send an empty patch", async () => {
    await useSettingsStore.getState().commitAppearance({});

    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  // Verify the backend response replaces the whole snapshot and clears the local preview.
  it("replaces the snapshot and clears the draft on success", async () => {
    const normalized = createSettingsSnapshot({}, { themePreset: "custom" });
    normalized.revision = "12";
    updateSettingsMock.mockResolvedValue(normalized);
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));

    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    expect(useSettingsStore.getState()).toMatchObject({
      snapshot: normalized,
      appearanceDraft: null,
      saveStatus: "idle",
      saveErrorCode: null,
      lastFailedPatch: null,
    });
  });

  // Verify the write status is observable while the command is still crossing the boundary.
  it("reports the saving status while a write is pending", async () => {
    const pending = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValue(pending.promise);

    const commit = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 16 });
    await Promise.resolve();
    expect(useSettingsStore.getState().saveStatus).toBe("saving");

    pending.resolve(createSettingsSnapshot());
    await commit;
    expect(useSettingsStore.getState().saveStatus).toBe("idle");
  });

  // Verify every correctable failure keeps the value on screen so the user can fix it.
  it.each(["invalid_color", "contrast_too_low", "persistence_failed", "unavailable"] as const)(
    "retains the draft after %s",
    async (code) => {
      const draft = createAppearanceSettings({ themeMode: "dark" });
      updateSettingsMock.mockRejectedValue(
        saveError({
          code,
          field: "interfaceColors.light.text",
          foreground: "interfaceColors.light.text",
          background: "interfaceColors.light.canvas",
        } as unknown as SettingsError),
      );
      useSettingsStore.getState().previewAppearance(draft);

      await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

      expect(useSettingsStore.getState()).toMatchObject({
        saveStatus: "error",
        saveErrorCode: code,
        appearanceDraft: draft,
      });
    },
  );

  // Verify every unrecoverable failure returns the controls to the committed snapshot.
  it.each([
    "value_out_of_range",
    "invalid_preset_combination",
    "empty_patch",
    "unauthorized_window",
    "corrupt_stored_settings",
  ] as const)("discards the draft after %s", async (code) => {
    updateSettingsMock.mockRejectedValue(
      saveError({
        code,
        field: "interfaceFontSizePx",
        min: 12,
        max: 20,
      } as unknown as SettingsError),
    );
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));

    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    expect(useSettingsStore.getState()).toMatchObject({
      saveStatus: "error",
      saveErrorCode: code,
      appearanceDraft: null,
    });
  });

  // Verify a rejection without a recognized code cannot masquerade as a known failure.
  it("discards the draft after an unknown rejection", async () => {
    updateSettingsMock.mockRejectedValue(new Error("transport"));
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));

    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    expect(useSettingsStore.getState()).toMatchObject({
      saveStatus: "error",
      saveErrorCode: "unknown",
      saveError: null,
      appearanceDraft: null,
    });
  });

  // Verify the backend detail survives so the page can name the field, pair or range.
  it("retains the full backend error detail", async () => {
    const payload: SettingsError = {
      code: "contrast_too_low",
      foreground: "interfaceColors.light.text",
      background: "interfaceColors.light.canvas",
    };
    updateSettingsMock.mockRejectedValue(saveError(payload));

    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    expect(useSettingsStore.getState().saveError).toEqual(payload);
    expect(classifySettingsSaveFailure(payload).group).toBe("interfaceColors");
  });

  // Verify the exact failed patch is retained so a retry repeats the same intent.
  it("retains the failed patch for an exact retry", async () => {
    updateSettingsMock.mockRejectedValueOnce(saveError({ code: "persistence_failed" }));

    await useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 18 });
    const failed = useSettingsStore.getState().lastFailedPatch;
    expect(failed).toEqual({ interfaceFontSizePx: 18 });

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    await useSettingsStore.getState().commitAppearance(failed ?? {});

    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      appearance: { interfaceFontSizePx: 18 },
    });
    expect(useSettingsStore.getState().saveStatus).toBe("idle");
  });

  // Verify only storage-level failures offer the retry action.
  it.each([
    ["persistence_failed", true],
    ["unavailable", true],
    ["invalid_color", false],
    ["contrast_too_low", false],
    ["value_out_of_range", false],
  ] as const)("classifies retry for %s as %s", (code, retryable) => {
    const payload = {
      code,
      field: "interfaceColors.light.text",
      foreground: "interfaceColors.light.text",
      background: "interfaceColors.light.canvas",
      min: 12,
      max: 20,
    } as unknown as SettingsError;

    expect(classifySettingsSaveFailure(payload).retryable).toBe(retryable);
  });

  // Verify a second commit waits for the first, so an older write can never land last.
  it("keeps exactly one write in flight", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);

    const one = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    await Promise.resolve();
    const two = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 16 });
    await Promise.resolve();
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    first.resolve(createSettingsSnapshot());
    await Promise.all([one, two]);

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      appearance: { interfaceFontSizePx: 16 },
    });
  });

  // Verify independent fields queued during one write are sent together afterwards.
  it("coalesces independent queued fields", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);

    const one = useSettingsStore.getState().commitAppearance({ themeMode: "dark" });
    await Promise.resolve();
    const two = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    const three = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 17 });
    const four = useSettingsStore.getState().commitAppearance({ terminalFontSizePx: 11 });

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    first.resolve(createSettingsSnapshot());
    await Promise.all([one, two, three, four]);

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      appearance: { interfaceFontSizePx: 17, terminalFontSizePx: 11 },
    });
  });

  // Verify a queued built-in preset drops the queued custom colours BE-008 forbids with it.
  it("drops queued custom colours when a built-in preset is queued after them", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);
    const appearance = createAppearanceSettings();

    const one = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    await Promise.resolve();
    const two = useSettingsStore.getState().commitAppearance({ themeMode: "dark" });
    const three = useSettingsStore
      .getState()
      .commitAppearance({ interfaceColors: appearance.interfaceColors });
    const four = useSettingsStore
      .getState()
      .commitAppearance({ terminalPalette: appearance.terminalPalette });
    const five = useSettingsStore.getState().commitAppearance({ themePreset: "ink" });

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    first.resolve(createSettingsSnapshot());
    await Promise.all([one, two, three, four, five]);

    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      appearance: { themeMode: "dark", themePreset: "ink" },
    });
  });

  // Verify the reverse conflict is resolved the same way, keeping the newer custom colours.
  it("drops a queued built-in preset when custom colours are queued after it", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);
    const appearance = createAppearanceSettings();

    const one = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    await Promise.resolve();
    const two = useSettingsStore.getState().commitAppearance({ themePreset: "paper" });
    const three = useSettingsStore
      .getState()
      .commitAppearance({ interfaceColors: appearance.interfaceColors });

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    first.resolve(createSettingsSnapshot());
    await Promise.all([one, two, three]);

    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      appearance: { interfaceColors: appearance.interfaceColors },
    });
  });

  // Verify an older response cannot erase the preview of an edit that is still queued.
  it("keeps the newest preview while an older response arrives", async () => {
    const first = deferred<AppSettingsDto>();
    const second = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const newer = createAppearanceSettings({ interfaceFontSizePx: 19 });

    const one = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    await Promise.resolve();
    useSettingsStore.getState().previewAppearance(newer);
    const two = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 19 });

    first.resolve(createSettingsSnapshot());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useSettingsStore.getState().appearanceDraft).toBe(newer);

    second.resolve(createSettingsSnapshot({}, { interfaceFontSizePx: 19 }));
    await Promise.all([one, two]);
    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
  });

  // Verify a failed write does not stall the queue behind it.
  it("continues the queue after a failure", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);

    const one = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 15 });
    await Promise.resolve();
    const two = useSettingsStore.getState().commitAppearance({ interfaceFontSizePx: 16 });

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    first.reject(saveError({ code: "persistence_failed" }));
    await Promise.all([one, two]);

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().saveStatus).toBe("idle");
  });

  // Verify restore reaches the backend and adopts only the snapshot it returns.
  it("restores appearance through the backend snapshot", async () => {
    const restored = createSettingsSnapshot();
    restored.revision = "42";
    restoreAppearanceDefaultsMock.mockResolvedValue(restored);
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));

    await useSettingsStore.getState().restoreAppearance();

    expect(restoreAppearanceDefaultsMock).toHaveBeenCalledWith();
    expect(useSettingsStore.getState()).toMatchObject({
      snapshot: restored,
      appearanceDraft: null,
      saveStatus: "idle",
    });
  });

  // Verify a failed restore is retryable without leaving a stale update patch behind.
  it("marks a failed restore without a failed patch", async () => {
    restoreAppearanceDefaultsMock.mockRejectedValueOnce(saveError({ code: "unavailable" }));

    await useSettingsStore.getState().restoreAppearance();
    expect(useSettingsStore.getState()).toMatchObject({
      saveStatus: "error",
      saveErrorCode: "unavailable",
      lastFailedPatch: null,
    });

    restoreAppearanceDefaultsMock.mockResolvedValueOnce(createSettingsSnapshot());
    await useSettingsStore.getState().restoreAppearance();
    expect(useSettingsStore.getState().saveStatus).toBe("idle");
  });

  // Verify restore shares the single write slot rather than racing an in-flight update.
  it("serializes restore behind a pending update", async () => {
    const first = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(first.promise);
    restoreAppearanceDefaultsMock.mockResolvedValue(createSettingsSnapshot());

    const update = useSettingsStore.getState().commitAppearance({ themeMode: "dark" });
    await Promise.resolve();
    const restore = useSettingsStore.getState().restoreAppearance();
    expect(restoreAppearanceDefaultsMock).not.toHaveBeenCalled();

    first.resolve(createSettingsSnapshot());
    await Promise.all([update, restore]);

    expect(restoreAppearanceDefaultsMock).toHaveBeenCalledOnce();
  });

  // Verify a new edit clears the previous failure so no stale alert outlives its value.
  it("clears a previous failure when the user edits again", async () => {
    updateSettingsMock.mockRejectedValueOnce(saveError({ code: "unavailable" }));
    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });
    expect(useSettingsStore.getState().saveStatus).toBe("error");

    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "light" }));

    expect(useSettingsStore.getState()).toMatchObject({
      saveStatus: "idle",
      saveErrorCode: null,
      saveError: null,
    });
  });

  // Verify an unsaveable preview can be dropped without touching the backend.
  it("discards the draft on request", () => {
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));

    useSettingsStore.getState().discardAppearanceDraft();

    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  // Verify reset clears every new field so no case inherits a draft or a failure.
  it("resets all appearance state", async () => {
    updateSettingsMock.mockRejectedValueOnce(saveError({ code: "persistence_failed" }));
    useSettingsStore.getState().previewAppearance(createAppearanceSettings({ themeMode: "dark" }));
    await useSettingsStore.getState().commitAppearance({ themeMode: "dark" });

    resetSettingsStore();

    expect(useSettingsStore.getState()).toMatchObject({
      status: "idle",
      snapshot: null,
      appearanceDraft: null,
      saveStatus: "idle",
      saveErrorCode: null,
      saveError: null,
      lastFailedPatch: null,
    });
  });
});

describe("bootstrapAppSettings", () => {
  // Give each bootstrap case a clean store and command double.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue(createSettingsSnapshot());
  });

  afterEach(() => {
    resetSettingsStore();
  });

  // Verify the startup read retains the area for the whole application and loads once.
  it("takes exactly one startup read", async () => {
    bootstrapAppSettings();
    await Promise.resolve();
    await Promise.resolve();

    expect(getSettingsMock).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().status).toBe("ready");
  });

  // Verify a second call, such as a development remount, reads nothing again.
  it("is idempotent", async () => {
    bootstrapAppSettings();
    bootstrapAppSettings();
    await Promise.resolve();
    await Promise.resolve();
    bootstrapAppSettings();

    expect(getSettingsMock).toHaveBeenCalledOnce();
  });

  // Verify a read already started by a mounted Settings frame is adopted, not repeated.
  it("reuses a load that is already in flight", async () => {
    const release = retainSettingsArea();
    const load = useSettingsStore.getState().load();

    bootstrapAppSettings();
    await load;

    expect(getSettingsMock).toHaveBeenCalledOnce();
    release();
  });

  // Verify test reset makes the application bootstrappable again.
  it("can bootstrap again after a reset", async () => {
    bootstrapAppSettings();
    await Promise.resolve();
    await Promise.resolve();

    resetSettingsStore();
    bootstrapAppSettings();
    await Promise.resolve();
    await Promise.resolve();

    expect(getSettingsMock).toHaveBeenCalledTimes(2);
  });
});
