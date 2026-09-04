import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcCallError } from "./ipc-error";
import { getSettings, restoreAppearanceDefaults, updateSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("getSettings", () => {
  // Clear the command boundary before every adapter assertion.
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // Verify the read command omits an argument object and returns its typed snapshot unchanged.
  it("calls get_settings without arguments", async () => {
    const snapshot = { revision: "7" };
    invokeMock.mockResolvedValue(snapshot);

    await expect(getSettings()).resolves.toBe(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("get_settings", undefined);
  });

  // Verify a generated Settings rejection remains available to feature-level classification.
  it("preserves a typed settings error", async () => {
    const rejection = { code: "unavailable" };
    invokeMock.mockRejectedValue(rejection);

    await expect(getSettings()).rejects.toMatchObject({
      command: "get_settings",
      payload: rejection,
    });
  });

  // Verify malformed transport failures are normalized without inventing a backend code.
  it("normalizes an unrecognized rejection", async () => {
    invokeMock.mockRejectedValue(new Error("transport"));

    await expect(getSettings()).rejects.toSatisfy(
      // Confirm both the shared error class and its deliberately empty payload.
      (error: unknown) => error instanceof IpcCallError && error.payload === null,
    );
  });
});

describe("updateSettings", () => {
  // Clear the command boundary before every adapter assertion.
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // Verify the write command wraps its patch in the exact `input` field the backend declares.
  it("calls update_settings with an input payload", async () => {
    const snapshot = { revision: "8" };
    invokeMock.mockResolvedValue(snapshot);

    await expect(updateSettings({ appearance: { themeMode: "dark" } })).resolves.toBe(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("update_settings", {
      input: { appearance: { themeMode: "dark" } },
    });
  });

  // Verify the adapter forwards the caller's patch verbatim and adds no sidebar section.
  it("sends no sidebar section of its own", async () => {
    invokeMock.mockResolvedValue({ revision: "9" });

    await updateSettings({ appearance: { interfaceFontSizePx: 16 } });

    const [, args] = invokeMock.mock.calls[0] ?? [];
    expect(args).toEqual({ input: { appearance: { interfaceFontSizePx: 16 } } });
    expect(JSON.stringify(args)).not.toContain("sidebar");
  });

  // Verify a validation rejection keeps every backend detail the page needs to explain it.
  it("preserves a typed validation error", async () => {
    const rejection = { code: "invalid_color", field: "interfaceColors.light.accent" };
    invokeMock.mockRejectedValue(rejection);

    await expect(updateSettings({ appearance: { themePreset: "ink" } })).rejects.toMatchObject({
      command: "update_settings",
      payload: rejection,
    });
  });
});

describe("restoreAppearanceDefaults", () => {
  // Clear the command boundary before every adapter assertion.
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // Verify the restore command takes no arguments and returns the whole replacement snapshot.
  it("calls restore_appearance_defaults without arguments", async () => {
    const snapshot = { revision: "10" };
    invokeMock.mockResolvedValue(snapshot);

    await expect(restoreAppearanceDefaults()).resolves.toBe(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("restore_appearance_defaults", undefined);
  });

  // Verify a restore rejection keeps its typed code for the same classification path.
  it("preserves a typed restore error", async () => {
    const rejection = { code: "persistence_failed" };
    invokeMock.mockRejectedValue(rejection);

    await expect(restoreAppearanceDefaults()).rejects.toMatchObject({
      command: "restore_appearance_defaults",
      payload: rejection,
    });
  });

  // Verify an unrecognized restore rejection is normalized like every other command.
  it("normalizes an unrecognized restore rejection", async () => {
    invokeMock.mockRejectedValue("boom");

    await expect(restoreAppearanceDefaults()).rejects.toSatisfy(
      (error: unknown) => error instanceof IpcCallError && error.payload === null,
    );
  });
});
