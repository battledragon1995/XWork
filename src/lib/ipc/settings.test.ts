import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcCallError } from "./ipc-error";
import { getSettings } from "./settings";

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
