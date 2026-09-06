import { StrictMode } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/data-management";
import { DataManagementProvider, useDataManagement } from "./data-management-provider";
/** Keep native operations isolated. */
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  prepareImportBackup: vi.fn(),
  cancelDataOperation: vi.fn(),
}));
/** Supply app callbacks without initializing real owners. */
const callbacks = {
  beforeConfirm: async () => () => {},
  onCommitted: async () => {},
  onResetUncertain: async () => {},
  refreshViews: async () => {},
};
/** Dispose mounted providers between cases. */
afterEach(cleanup);
/** StrictMode replay must not prepare a backup on its own. */
it("preserves one idle owner across StrictMode and child changes", async () => {
  const observed: unknown[] = [];
  /** Record the public method identity across effect replay. */
  function Child() {
    const state = useDataManagement();
    observed.push(state.prepare);
    return null;
  }
  const view = render(
    <StrictMode>
      <DataManagementProvider {...callbacks}>
        <Child />
      </DataManagementProvider>
    </StrictMode>,
  );
  view.rerender(
    <StrictMode>
      <DataManagementProvider {...callbacks}>
        <Child />
        <span>new route</span>
      </DataManagementProvider>
    </StrictMode>,
  );
  expect(new Set(observed).size).toBe(1);
  expect(ipc.prepareImportBackup).not.toHaveBeenCalled();
});
/** Unmount retirement cancels the exact ID returned after provider disposal. */
it("cancels late prepare after unmount", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof ipc.prepareImportBackup>>) => void;
  vi.mocked(ipc.prepareImportBackup).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const hook = renderHook(useDataManagement, {
    wrapper: /** Mount only the test operation owner. */ ({ children }) => (
      <DataManagementProvider {...callbacks}>{children}</DataManagementProvider>
    ),
  });
  act(() => hook.result.current.setListenerStatus("ready"));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.prepare("import");
  });
  await waitFor(() => expect(ipc.prepareImportBackup).toHaveBeenCalledOnce());
  hook.unmount();
  resolve({
    kind: "ready",
    preview: {
      requestId: 7,
      createdAtMs: 0n,
      sourceAppVersion: "test",
      schemaVersion: 1,
      counts: {
        projects: 0,
        customCliProfiles: 0,
        secretReferences: 0,
        keyboardShortcutOverrides: 0,
        notes: null,
        events: null,
      },
      merge: { inserts: 0, updates: 0, unchanged: 0, removals: 0, projectPathMatches: 0 },
    },
  });
  await pending;
  expect(ipc.cancelDataOperation).toHaveBeenCalledExactlyOnceWith(7);
});
