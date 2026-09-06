import { beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/data-management";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { createDataManagementState } from "./data-management-state";
/** Mock commands only; preserve preview validation used by safe error classification. */
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  exportBackup: vi.fn(),
  prepareImportBackup: vi.fn(),
  prepareResetXwork: vi.fn(),
  confirmImportBackup: vi.fn(),
  confirmResetXwork: vi.fn(),
  cancelDataOperation: vi.fn(),
}));
const impact = {
  requestId: 1,
  projects: 0,
  customCliProfiles: 0,
  keyboardShortcutOverrides: 0,
  settingsDifferFromDefault: false,
  notes: 0,
  events: 0,
  sessions: 0,
  runningProcesses: 0,
  unsavedDocuments: 0,
};
const preview = {
  requestId: 2,
  schemaVersion: 1,
  createdAtMs: 0n,
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
/** Expose precise settlement without timers or native work. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Create an isolated owner with explicit reconciliation collaborators. */
function fixture() {
  const release = vi.fn();
  const callbacks = {
    beforeConfirm: vi.fn(async () => release),
    onCommitted: vi.fn(async () => {}),
    onResetUncertain: vi.fn(async () => {}),
    refreshViews: vi.fn(async () => {}),
  };
  const store = createDataManagementState(callbacks);
  store.getSnapshot().setListenerStatus("ready");
  return { store, callbacks, release };
}
/** Restore deterministic backend answers. */
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.prepareResetXwork).mockResolvedValue(impact);
  vi.mocked(ipc.prepareImportBackup).mockResolvedValue({ kind: "ready", preview });
  vi.mocked(ipc.confirmResetXwork).mockResolvedValue({
    projectsRemoved: 0,
    customCliProfilesRemoved: 0,
    keyboardShortcutOverridesRemoved: 0,
    settingsReset: true,
    notesRemoved: 0,
    eventsRemoved: 0,
    sessionsStopped: 0,
    credentialCleanupPending: 0,
  });
  vi.mocked(ipc.confirmImportBackup).mockResolvedValue({
    schemaVersion: 1,
    applied: preview.merge,
    credentialCleanupPending: 0,
  });
  vi.mocked(ipc.cancelDataOperation).mockResolvedValue(undefined);
});
/** A late native ready is cancelled exactly once and never displayed after route retirement. */
it("owns prepare flight through retirement and late ready", async () => {
  const { store } = fixture();
  const pending = deferred<typeof impact>();
  vi.mocked(ipc.prepareResetXwork).mockReturnValue(pending.promise);
  const first = store.getSnapshot().prepare("reset");
  const duplicate = store.getSnapshot().prepare("reset");
  const retired = store.getSnapshot().retirePreview();
  await duplicate;
  expect(store.getSnapshot().busy).toBe(true);
  pending.resolve(impact);
  await Promise.all([first, retired]);
  expect(ipc.prepareResetXwork).toHaveBeenCalledOnce();
  expect(ipc.cancelDataOperation).toHaveBeenCalledExactlyOnceWith(1);
  expect(store.getSnapshot()).toMatchObject({ phase: "idle", preview: null, busy: false });
});
/** Picker cancellation never invents a pending request. */
it("returns cancelled export to idle without cancellation IPC", async () => {
  const { store } = fixture();
  vi.mocked(ipc.exportBackup).mockResolvedValue({ kind: "cancelled" });
  await store.getSnapshot().prepare("export");
  expect(store.getSnapshot().message).toBeNull();
  expect(ipc.cancelDataOperation).not.toHaveBeenCalled();
});
/** The literal is case-sensitive and a duplicate confirm cannot bypass the lock. */
it("requires explicit RESET and holds barriers through the command", async () => {
  const { store, release } = fixture();
  await store.getSnapshot().prepare("reset");
  store.getSnapshot().setConfirmation("reset");
  await store.getSnapshot().confirm();
  expect(ipc.confirmResetXwork).not.toHaveBeenCalled();
  store.getSnapshot().setConfirmation(" RESET ");
  const done = store.getSnapshot().confirm();
  await store.getSnapshot().confirm();
  await done;
  expect(ipc.confirmResetXwork).toHaveBeenCalledExactlyOnceWith(1, " RESET ");
  expect(release).toHaveBeenCalledOnce();
  expect(store.getSnapshot().resetEpoch).toBe(1);
});
/** A replacement preview needs a distinct user confirmation and barrier acquisition. */
it("requires reconfirmation after preview_changed", async () => {
  const { store, release, callbacks } = fixture();
  await store.getSnapshot().prepare("import");
  vi.mocked(ipc.confirmImportBackup).mockRejectedValueOnce(
    new IpcCallError("confirm", {
      code: "import_preview_changed",
      preview: { ...preview, requestId: 3 },
    }),
  );
  await store.getSnapshot().confirm();
  expect(store.getSnapshot()).toMatchObject({ phase: "preview", preview: { requestId: 3 } });
  expect(release).toHaveBeenCalledOnce();
  expect(ipc.confirmImportBackup).toHaveBeenCalledOnce();
  await store.getSnapshot().confirm();
  expect(ipc.confirmImportBackup).toHaveBeenLastCalledWith(3);
  expect(callbacks.beforeConfirm).toHaveBeenCalledTimes(2);
});
/** A known commit event wins over a later transport rejection without releasing apply early. */
it("coalesces event before rejection but accepts later distinct resets", async () => {
  const { store, callbacks, release } = fixture();
  const response = deferred<Awaited<ReturnType<typeof ipc.confirmResetXwork>>>();
  vi.mocked(ipc.confirmResetXwork).mockReturnValueOnce(response.promise);
  await store.getSnapshot().prepare("reset");
  store.getSnapshot().setConfirmation("RESET");
  const done = store.getSnapshot().confirm();
  await Promise.resolve();
  await Promise.resolve();
  await store.getSnapshot().acceptCommitted("app_reset");
  expect(store.getSnapshot().busy).toBe(true);
  expect(release).not.toHaveBeenCalled();
  response.reject("secret");
  await done;
  expect(store.getSnapshot().failure).toBeNull();
  expect(callbacks.onCommitted).toHaveBeenCalledOnce();
  await store.getSnapshot().acceptCommitted("app_reset");
  expect(callbacks.onCommitted).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot().resetEpoch).toBe(2);
});
/** Unknown outcomes remain explicit after reads until separately acknowledged. */
it("never retries unknown mutations and requires reconciliation acknowledgement", async () => {
  const { store, callbacks } = fixture();
  await store.getSnapshot().prepare("import");
  vi.mocked(ipc.confirmImportBackup).mockRejectedValueOnce("private");
  await store.getSnapshot().confirm();
  store.getSnapshot().acknowledgeUncertain();
  expect(store.getSnapshot().phase).toBe("uncertain");
  await store.getSnapshot().prepare("reset");
  expect(ipc.prepareResetXwork).not.toHaveBeenCalled();
  await store.getSnapshot().refreshViews();
  expect(callbacks.refreshViews).toHaveBeenCalledOnce();
  expect(store.getSnapshot().phase).toBe("uncertain");
  store.getSnapshot().acknowledgeUncertain();
  expect(store.getSnapshot().phase).toBe("idle");
  expect(ipc.confirmImportBackup).toHaveBeenCalledOnce();
});
/** TTL errors remove stale IDs instead of silently preparing another operation. */
it.each(["stale_request", "no_pending_operation"])("retires %s", async (code) => {
  const { store } = fixture();
  await store.getSnapshot().prepare("import");
  vi.mocked(ipc.confirmImportBackup).mockRejectedValueOnce(new IpcCallError("confirm", { code }));
  await store.getSnapshot().confirm();
  expect(store.getSnapshot().preview).toBeNull();
  expect(store.getSnapshot().phase).toBe("idle");
  expect(ipc.prepareImportBackup).toHaveBeenCalledOnce();
});
/** A producer uncertainty blocks confirm without dropping the preview. */
it("does not send confirm when a producer barrier rejects", async () => {
  const { store, callbacks } = fixture();
  await store.getSnapshot().prepare("import");
  callbacks.beforeConfirm.mockRejectedValueOnce(new Error("uncertain"));
  await store.getSnapshot().confirm();
  expect(ipc.confirmImportBackup).not.toHaveBeenCalled();
  expect(store.getSnapshot().phase).toBe("preview");
});
/** Listener registration is a temporary gate, while failure offers command-result fallback. */
it("gates registering but allows listener fallback", async () => {
  const { store } = fixture();
  store.getSnapshot().setListenerStatus("registering");
  await store.getSnapshot().prepare("reset");
  expect(ipc.prepareResetXwork).not.toHaveBeenCalled();
  store.getSnapshot().setListenerStatus("error");
  await store.getSnapshot().prepare("reset");
  expect(ipc.prepareResetXwork).toHaveBeenCalledOnce();
});

/** An external commit retires a displayed preview instead of leaving an empty stuck phase. */
it("retires preview on an external commit", async () => {
  const { store } = fixture();
  await store.getSnapshot().prepare("import");
  await store.getSnapshot().acceptCommitted("app_reset");
  expect(store.getSnapshot().phase).toBe("idle");
  expect(store.getSnapshot().preview).toBeNull();
});
