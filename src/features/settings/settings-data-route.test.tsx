import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/data-management";
import { DataManagementProvider, useDataManagement } from "./data-management-provider";
import { SettingsDataRoute } from "./settings-data-route";
import type { DataManagementState } from "./data-management-state";
/** Keep every Data boundary mocked, including the location and native picker. */
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  getDataLocation: vi.fn(),
  copyDataLocation: vi.fn(),
  openDataLocation: vi.fn(),
  exportBackup: vi.fn(),
}));
let data: DataManagementState;
/** Read the owner so a listener can be marked ready without a native registration. */
function Host() {
  data = useDataManagement();
  return <SettingsDataRoute />;
}
/** Render without settings bootstrap or real app providers. */
function mount() {
  render(
    <DataManagementProvider
      beforeConfirm={async () => () => {}}
      onCommitted={async () => {}}
      onResetUncertain={async () => {}}
      refreshViews={async () => {}}
    >
      <Host />
    </DataManagementProvider>,
  );
  act(() => data.setListenerStatus("ready"));
}
/** Restore local test paths and isolated native answers. */
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.getDataLocation).mockResolvedValue({
    directory: "test-only/very-long/location",
    databaseFileName: "xwork.db",
    logsDirectoryName: "logs",
  });
});
/** Retire every route and pending request. */
afterEach(cleanup);
/** Data is usable even if the independent location read fails. */
it("keeps backup actions available during location failure", async () => {
  vi.mocked(ipc.getDataLocation).mockRejectedValueOnce("private detail");
  mount();
  await screen.findByText("Could not read the data location.");
  expect(screen.getByRole("button", { name: "Export backup…" })).toBeEnabled();
  expect(screen.getByText(/This unencrypted backup/)).toBeVisible();
  expect(screen.queryByText(/Notes:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Data location")).toHaveValue("test-only/very-long/location");
});
/** Clipboard and opener failures preserve the full selectable path and never send it back. */
it("uses no path args and preserves manual copy on errors", async () => {
  vi.mocked(ipc.copyDataLocation).mockRejectedValueOnce("private");
  vi.mocked(ipc.openDataLocation).mockRejectedValueOnce("private");
  mount();
  await screen.findByLabelText("Data location");
  fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
  await screen.findByText("Could not copy the path.");
  expect(ipc.copyDataLocation).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
  await screen.findByText("Could not open the data folder.");
  expect(ipc.openDataLocation).toHaveBeenCalledExactlyOnceWith();
  expect(screen.getByLabelText("Data location")).toHaveValue("test-only/very-long/location");
});
