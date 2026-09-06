import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/data-management";
import { DataManagementProvider, useDataManagement } from "./data-management-provider";
import type { DataManagementState } from "./data-management-state";
import { DataOperationDialog } from "./data-operation-dialog";
import { IpcCallError } from "@/lib/ipc/ipc-error";
/** No picker, credentials or runtime is used by modal tests. */
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  prepareResetXwork: vi.fn(),
  prepareImportBackup: vi.fn(),
  confirmResetXwork: vi.fn(),
  confirmImportBackup: vi.fn(),
  cancelDataOperation: vi.fn(),
}));
let data: DataManagementState;
const callbacks = {
  beforeConfirm: async () => () => {},
  onCommitted: async () => {},
  onResetUncertain: async () => {},
  refreshViews: async () => {},
};
/** Expose the real coordinator and render its actual modal. */
function Host() {
  data = useDataManagement();
  return <DataOperationDialog />;
}
/** Start an isolated preview with nonzero unsaved impact and otherwise zero counts. */
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.prepareResetXwork).mockResolvedValue({
    requestId: 1,
    projects: 0,
    customCliProfiles: 0,
    keyboardShortcutOverrides: 0,
    settingsDifferFromDefault: false,
    notes: 0,
    events: 0,
    sessions: 0,
    runningProcesses: 0,
    unsavedDocuments: 2,
  });
  render(
    <DataManagementProvider {...callbacks}>
      <Host />
    </DataManagementProvider>,
  );
  act(() => data.setListenerStatus("ready"));
});
/** Release modal focus and coordinator lifetime. */
afterEach(cleanup);
/** Reset requires an explicit button action, including when IME uses Enter. */
it("focuses Cancel, requires exact RESET and ignores input Enter", async () => {
  await act(() => data.prepare("reset"));
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  const confirm = screen.getByRole("button", { name: "Reset XWork" });
  const input = screen.getByLabelText("Type RESET to confirm");
  expect(confirm).toBeDisabled();
  fireEvent.change(input, { target: { value: "reset" } });
  expect(confirm).toBeDisabled();
  fireEvent.change(input, { target: { value: " RESET " } });
  expect(confirm).toBeEnabled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(ipc.confirmResetXwork).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Unsaved documents: 2");
  expect(screen.getByText(/Projects: 0/)).toBeVisible();
  expect(screen.queryByText(/Notes:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(ipc.cancelDataOperation).toHaveBeenCalledWith(1);
});
/** While confirm is unresolved, Escape and repeated activation cannot release the modal. */
it("keeps apply modal locked until result settles", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof ipc.confirmResetXwork>>) => void;
  vi.mocked(ipc.confirmResetXwork).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  await act(() => data.prepare("reset"));
  fireEvent.change(screen.getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset XWork" }));
  await waitFor(() => expect(ipc.confirmResetXwork).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () =>
    resolve({
      projectsRemoved: 0,
      customCliProfilesRemoved: 0,
      keyboardShortcutOverridesRemoved: 0,
      settingsReset: true,
      notesRemoved: 0,
      eventsRemoved: 0,
      sessionsStopped: 0,
      credentialCleanupPending: 1,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
/** Updated merge preview is visible, focused and never auto-applied. */
it("renders import metadata and focuses changed preview", async () => {
  const preview = {
    requestId: 2,
    schemaVersion: 1,
    createdAtMs: 0n,
    sourceAppVersion: "<script>test</script>",
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
  vi.mocked(ipc.prepareImportBackup).mockResolvedValue({ kind: "ready", preview });
  vi.mocked(ipc.confirmImportBackup).mockRejectedValue(
    new IpcCallError("confirm", {
      code: "import_preview_changed",
      preview: { ...preview, requestId: 3, merge: { ...preview.merge, inserts: 4 } },
    }),
  );
  await act(() => data.prepare("import"));
  expect(screen.getByText(/Backup schema 1/)).toHaveTextContent("<script>test</script>");
  fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
  await screen.findByText(/Review the updated preview/);
  expect(screen.getByText(/Inserts: 4/).parentElement).toHaveFocus();
  expect(ipc.confirmImportBackup).toHaveBeenCalledOnce();
});
