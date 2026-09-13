import { StrictMode } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/data-management";
import type { AppSettingsDto } from "@/bindings/settings";
import { updateSettings } from "@/lib/ipc/settings";
import { DataManagementProvider, useDataManagement } from "./data-management-provider";
import { resetSettingsStore, useSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";
/** Keep native operations isolated. */
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  prepareImportBackup: vi.fn(),
  prepareResetXwork: vi.fn(),
  confirmImportBackup: vi.fn(),
  confirmResetXwork: vi.fn(),
  cancelDataOperation: vi.fn(),
}));
/** Isolate policy persistence while using its real maintenance barrier. */
vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
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

/** Both destructive operation types must wait for the same sent notification write. */
it.each(["import", "reset"] as const)(
  "settles notification settings before confirming %s",
  async (operation) => {
    resetSettingsStore();
    vi.clearAllMocks();
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    let resolve!: (snapshot: AppSettingsDto) => void;
    vi.mocked(updateSettings).mockReturnValueOnce(
      new Promise(
        /** Hold the actual durable write. */ (yes) => {
          resolve = yes;
        },
      ),
    );
    const write = useSettingsStore.getState().commitNotifications({ eventRemindersEnabled: false });
    const preview = {
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
    };
    vi.mocked(ipc.prepareImportBackup).mockResolvedValueOnce({ kind: "ready", preview });
    vi.mocked(ipc.prepareResetXwork).mockResolvedValueOnce({
      requestId: 7,
      projects: 0,
      customCliProfiles: 0,
      keyboardShortcutOverrides: 0,
      settingsDifferFromDefault: false,
      notes: 0,
      events: 0,
      sessions: 0,
      runningProcesses: 0,
      unsavedDocuments: 0,
    });
    const hook = renderHook(useDataManagement, {
      wrapper: /** Attach real Settings settlement to the isolated operation owner. */ ({
        children,
      }) => (
        <DataManagementProvider
          {...callbacks}
          beforeConfirm={
            /** Hold Settings admission until maintenance has reconciled. */ async () => {
              await useSettingsStore.getState().settleBeforeDataChange();
              return useSettingsStore.getState().releaseDataChangeBarrier;
            }
          }
        >
          {children}
        </DataManagementProvider>
      ),
    });
    act(
      /** Allow explicit operations after listener readiness. */ () =>
        hook.result.current.setListenerStatus("ready"),
    );
    await act(
      /** Prepare the operation using the isolated backend preview. */ async () =>
        hook.result.current.prepare(operation),
    );
    act(
      /** Supply the required confirmation for reset. */ () =>
        hook.result.current.setConfirmation("RESET"),
    );
    let confirmation!: Promise<void>;
    act(
      /** Begin confirmation while policy persistence is still pending. */ () => {
        confirmation = hook.result.current.confirm();
      },
    );
    await waitFor(
      /** Observe the synchronous write admission barrier. */ () =>
        expect(useSettingsStore.getState().dataChangeBlocked).toBe(true),
    );
    expect(ipc.confirmImportBackup).not.toHaveBeenCalled();
    expect(ipc.confirmResetXwork).not.toHaveBeenCalled();
    await act(
      /** Release policy persistence before awaiting the maintenance command. */ async () => {
        resolve(createSettingsSnapshot());
        await write;
        await confirmation;
      },
    );
    if (operation === "import") expect(ipc.confirmImportBackup).toHaveBeenCalledExactlyOnceWith(7);
    else expect(ipc.confirmResetXwork).toHaveBeenCalledExactlyOnceWith(7, "RESET");
    expect(useSettingsStore.getState().dataChangeBlocked).toBe(false);
    hook.unmount();
    resetSettingsStore();
  },
);

/** A lost policy response prevents sending a destructive confirmation to the backend. */
it("blocks maintenance when a notification write outcome is uncertain", async () => {
  resetSettingsStore();
  vi.clearAllMocks();
  useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
  vi.mocked(updateSettings).mockRejectedValueOnce(new Error("transport"));
  await useSettingsStore.getState().commitNotifications({ eventRemindersEnabled: false });
  vi.mocked(ipc.prepareResetXwork).mockResolvedValueOnce({
    requestId: 9,
    projects: 0,
    customCliProfiles: 0,
    keyboardShortcutOverrides: 0,
    settingsDifferFromDefault: false,
    notes: 0,
    events: 0,
    sessions: 0,
    runningProcesses: 0,
    unsavedDocuments: 0,
  });
  const hook = renderHook(useDataManagement, {
    wrapper: /** Match app composition's release-on-acquisition-failure behavior. */ ({
      children,
    }) => (
      <DataManagementProvider
        {...callbacks}
        beforeConfirm={
          /** Refuse destructive work until settings reconcile. */ async () => {
            try {
              await useSettingsStore.getState().settleBeforeDataChange();
              return useSettingsStore.getState().releaseDataChangeBarrier;
            } catch (error) {
              useSettingsStore.getState().releaseDataChangeBarrier();
              throw error;
            }
          }
        }
      >
        {children}
      </DataManagementProvider>
    ),
  });
  act(
    /** Allow preparation from the ready owner. */ () =>
      hook.result.current.setListenerStatus("ready"),
  );
  await act(
    /** Read reset impact without writing data. */ async () => hook.result.current.prepare("reset"),
  );
  act(
    /** Supply the explicit reset confirmation. */ () =>
      hook.result.current.setConfirmation("RESET"),
  );
  await act(
    /** Attempt confirmation through the uncertain Settings barrier. */ async () =>
      hook.result.current.confirm(),
  );
  expect(ipc.confirmResetXwork).not.toHaveBeenCalled();
  expect(hook.result.current.failure).not.toBeNull();
  expect(useSettingsStore.getState().notificationUncertain).toBe(true);
  hook.unmount();
  resetSettingsStore();
});
