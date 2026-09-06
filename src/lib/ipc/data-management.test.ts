import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as ipc from "./data-management";
import { IpcCallError } from "./ipc-error";
/** Isolate every native invocation. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** A valid immutable native preview fixture, with serde's numeric timestamp. */
const preview = {
  requestId: 2,
  schemaVersion: 1,
  createdAtMs: 123,
  sourceAppVersion: "test",
  counts: {
    projects: 0,
    customCliProfiles: 0,
    secretReferences: 0,
    keyboardShortcutOverrides: 0,
    notes: null,
    events: null,
  },
  merge: { inserts: 0, updates: 0, unchanged: 0, removals: 0, projectPathMatches: 0 },
};
/** Remove previous command observations. */
beforeEach(() => vi.clearAllMocks());
/** Every wrapper matches Rust's argument spelling and accepts no filesystem path. */
it.each([
  ["get_data_location", ipc.getDataLocation, undefined],
  ["open_data_location", ipc.openDataLocation, undefined],
  ["copy_data_location", ipc.copyDataLocation, undefined],
  ["export_backup", ipc.exportBackup, undefined],
  ["prepare_reset_xwork", ipc.prepareResetXwork, undefined],
  ["confirm_import_backup", () => ipc.confirmImportBackup(2), { requestId: 2 }],
  [
    "confirm_reset_xwork",
    () => ipc.confirmResetXwork(2, " RESET "),
    { requestId: 2, confirmation: " RESET " },
  ],
  ["cancel_data_operation", () => ipc.cancelDataOperation(2), { requestId: 2 }],
] as const)("binds %s exactly", async (command, call, args) => {
  vi.mocked(invoke).mockResolvedValue({ kind: "cancelled" });
  await call();
  expect(invoke).toHaveBeenCalledExactlyOnceWith(command, args);
});
/** The ready outcome normalizes only its i64 timestamp. */
it("normalizes the ninth command and its cancellation", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({ kind: "ready", preview })
    .mockResolvedValueOnce({ kind: "cancelled" });
  expect(await ipc.prepareImportBackup()).toEqual({
    kind: "ready",
    preview: { ...preview, createdAtMs: 123n },
  });
  expect(await ipc.prepareImportBackup()).toEqual({ kind: "cancelled" });
  expect(invoke).toHaveBeenNthCalledWith(1, "prepare_import_backup", undefined);
  expect(invoke).toHaveBeenCalledTimes(2);
});
/** Unsafe dates and nested previews must never create an actionable replacement. */
it.each([NaN, 1.2, Number.MAX_SAFE_INTEGER + 1, "123", null])(
  "rejects unsafe timestamp %s",
  async (createdAtMs) => {
    vi.mocked(invoke).mockRejectedValue({
      code: "import_preview_changed",
      preview: { ...preview, createdAtMs },
    });
    await expect(ipc.confirmImportBackup(2)).rejects.toMatchObject({ payload: null });
  },
);
/** Valid dates beyond Date range remain bigint for safe UI fallback. */
it("normalizes changed previews and validates nested counts", async () => {
  vi.mocked(invoke).mockRejectedValueOnce({
    code: "import_preview_changed",
    preview: { ...preview, createdAtMs: 8640000000000001n },
  });
  await expect(ipc.confirmImportBackup(2)).rejects.toMatchObject({
    payload: { preview: { createdAtMs: 8640000000000001n } },
  });
  vi.mocked(invoke).mockRejectedValueOnce({
    code: "import_preview_changed",
    preview: { ...preview, merge: {} },
  });
  await expect(ipc.confirmImportBackup(2)).rejects.toMatchObject({ payload: null });
});
/** Raw native diagnostics remain normalized uncertainty. */
it("redacts unknown rejection", async () => {
  vi.mocked(invoke).mockRejectedValue("private credential path");
  await expect(ipc.exportBackup()).rejects.toBeInstanceOf(IpcCallError);
});
/** Aggregate listeners expose payload only and preserve their real unsubscribe. */
it("unwraps aggregate events", async () => {
  const remove = vi.fn();
  const callback = vi.fn();
  vi.mocked(listen).mockImplementationOnce(async (_name, handler) => {
    handler({ event: "data://changed", id: 1, payload: { kind: "app_reset" } });
    return remove;
  });
  const unsubscribe = await ipc.onDataChanged(callback);
  expect(callback).toHaveBeenCalledExactlyOnceWith({ kind: "app_reset" });
  unsubscribe();
  expect(remove).toHaveBeenCalledOnce();
});
