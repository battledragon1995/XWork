import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataChangedEventDto } from "@/bindings/data-management";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileExplorer } from "@/features/files";
import { deferred, entry, explorerProps, page, project } from "@/features/files/files-test-fixture";
import { resetProjectsStore, useProjectsStore } from "@/features/projects/projects-store";
import { resetSessionsStore, useSessionsStore } from "@/features/sessions/sessions-store";
import { resetCliProfilesStore } from "@/features/settings/cli-profiles-store";
import { useDataManagement } from "@/features/settings/data-management-provider";
import type { DataManagementState } from "@/features/settings/data-management-state";
import { resetSettingsStore } from "@/features/settings/settings-store";
import { createSettingsSnapshot } from "@/features/settings/settings-test-fixture";
import * as ipc from "@/lib/ipc/data-management";
import * as files from "@/lib/ipc/files";
import { getProject, listProjects } from "@/lib/ipc/projects";
import { listSessions } from "@/lib/ipc/sessions";
import { getSettings } from "@/lib/ipc/settings";
import { DataManagementBridge, DataManagementHost } from "./data-management-bridge";
import { resetShellStore, useShellStore } from "./shell-store";

/** Replace navigation and the renderer boundary with explicit isolated collaborators. */
const fake = vi.hoisted(() => ({
  navigate: vi.fn(),
  clear: vi.fn(),
  reconcile: vi.fn(async () => {}),
  shortcutRefresh: vi.fn(async () => {}),
  settle: vi.fn(async () => {}),
  release: vi.fn(),
}));
vi.mock("react-router", () => ({ useNavigate: () => fake.navigate }));
vi.mock("@/features/terminal", () => ({
  useTerminalDataBoundary: () => ({
    clearAfterReset: fake.clear,
    reconcileAfterResetFailure: fake.reconcile,
  }),
}));
vi.mock("@/features/settings/keyboard-shortcuts-provider", () => ({
  useKeyboardShortcuts: () => ({
    refreshAfterDataChange: fake.shortcutRefresh,
    settleBeforeDataChange: fake.settle,
    releaseDataChangeBarrier: fake.release,
  }),
}));
/** Use real owner stores backed only by mocked queries. */
vi.mock("@/lib/ipc/projects", () => ({
  getProject: vi.fn(),
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
}));
/** Files actions use only isolated promise seams, never native clipboard or reveal. */
vi.mock("@/lib/ipc/files");
vi.mock("@/lib/ipc/sessions", () => ({
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));
vi.mock("@/lib/ipc/cli-profiles", () => ({
  getCliProfiles: vi.fn(),
  onCliProfilesChanged: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/ipc/data-management", async (original) => ({
  ...(await original<typeof ipc>()),
  onDataChanged: vi.fn(),
  prepareResetXwork: vi.fn(),
  confirmResetXwork: vi.fn(),
  cancelDataOperation: vi.fn(),
}));
let data: DataManagementState;
let emit: (event: DataChangedEventDto) => void;
/** Capture the real public coordinator inside the app host. */
function Probe() {
  data = useDataManagement();
  return (
    <>
      <h1>Home</h1>
      <DataManagementBridge />
    </>
  );
}
/** Supply temporary DTOs and no native resource defaults. */
beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsStore();
  resetProjectsStore();
  resetSessionsStore();
  resetCliProfilesStore();
  resetShellStore();
  vi.mocked(getSettings).mockResolvedValue({
    ...createSettingsSnapshot(),
    sidebar: { widthPx: 300, collapsed: true },
  });
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(ipc.onDataChanged).mockImplementation(async (callback) => {
    emit = callback;
    return () => {};
  });
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
    unsavedDocuments: 0,
  });
});
/** Release listeners and owner state between cases. */
afterEach(() => {
  cleanup();
  resetSettingsStore();
  resetProjectsStore();
  resetSessionsStore();
  resetCliProfilesStore();
});
/** Render only the app bridge with its explicit owner mocks. */
async function mount() {
  const view = render(
    <DataManagementHost>
      <Probe />
    </DataManagementHost>,
  );
  await waitFor(() => expect(data.listenerStatus).toBe("ready"));
  return view;
}

/** Compose the public Files boundary with the real Data owner used by the host. */
function FilesProbe() {
  const owner = useDataManagement();
  return (
    <TooltipProvider>
      <FileExplorer
        {...explorerProps()}
        boundary={{ epoch: owner.invalidationEpoch, suspended: owner.busy }}
        readBoundary={() => {
          const live = owner.getCurrent();
          return { epoch: live.invalidationEpoch, suspended: live.busy };
        }}
      />
    </TooltipProvider>
  );
}
/** The real coordinator invalidates pending Files work before owner refresh completes. */
it("retires Files path responses during reset even when a project refresh fails", async () => {
  const paths = deferred<{ absolutePath: string; relativePath: string }>();
  const refreshedRoot = deferred<ReturnType<typeof page>>();
  const clipboard = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  vi.mocked(getProject).mockResolvedValue(project);
  vi.mocked(files.listFileChildren)
    .mockResolvedValueOnce(page("", [entry("old.ts")]))
    .mockReturnValue(refreshedRoot.promise);
  vi.mocked(files.getFileEntryPaths).mockReturnValue(paths.promise);
  try {
    render(
      <DataManagementHost>
        <Probe />
        <FilesProbe />
        <div data-testid="durable-shell" />
      </DataManagementHost>,
    );
    const row = await screen.findByRole("treeitem", { name: "old.ts" });
    const shell = screen.getByTestId("durable-shell");
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(files.getFileEntryPaths).toHaveBeenCalledOnce());
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("isolated refresh failure"));
    await act(async () => {
      emit({ kind: "app_reset" });
      paths.resolve({ relativePath: "old.ts", absolutePath: "X:/obsolete/old.ts" });
    });
    await screen.findByText("Changes were saved, but some views could not be refreshed.");
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.queryByRole("treeitem", { name: "old.ts" })).not.toBeInTheDocument();
    expect(screen.getByTestId("durable-shell")).toBe(shell);
    expect(fake.clear).toHaveBeenCalledOnce();
    await act(async () => refreshedRoot.resolve(page("", [entry("fresh.ts")])));
    await screen.findByRole("treeitem", { name: "fresh.ts" });
    expect(files.getFileEntryPaths).toHaveBeenCalledOnce();
  } finally {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
/** Reset clears stale rows synchronously and attempts every refresh despite failure. */
it("clears reset projections, navigates and retries only failed reads", async () => {
  await mount();
  useProjectsStore.setState({ projects: [{ id: "old" } as never] });
  useSessionsStore.setState({ sessionsByProject: { old: [{ id: "old" } as never] } });
  vi.mocked(listProjects).mockRejectedValueOnce(new Error("temporary read"));
  useShellStore.setState({ isMaximized: true });
  await act(async () => emit({ kind: "app_reset" }));
  await screen.findByText("Changes were saved, but some views could not be refreshed.");
  expect(useProjectsStore.getState().projects).toEqual([]);
  expect(useSessionsStore.getState().sessionsByProject).toEqual({});
  expect(fake.navigate).toHaveBeenCalledWith("/", { replace: true });
  expect(fake.clear).toHaveBeenCalledOnce();
  expect(fake.shortcutRefresh).toHaveBeenCalledOnce();
  expect(useShellStore.getState()).toMatchObject({
    sidebarWidthPx: 300,
    isSidebarCollapsed: true,
    isMaximized: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh views" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Changes were saved, but some views could not be refreshed."),
    ).toBeNull(),
  );
  expect(listProjects).toHaveBeenCalledTimes(2);
  expect(getSettings).toHaveBeenCalledOnce();
  expect(listSessions).toHaveBeenCalledOnce();
  expect(fake.clear).toHaveBeenCalledOnce();
});
/** Import changes metadata without disposing active terminal renderers or replacing route. */
it("preserves terminal identity and route on import", async () => {
  await mount();
  await act(async () => emit({ kind: "backup_imported" }));
  await screen.findByText("Backup imported.");
  expect(fake.clear).not.toHaveBeenCalled();
  expect(fake.navigate).not.toHaveBeenCalled();
  expect(fake.shortcutRefresh).toHaveBeenCalledOnce();
});
/** Late duplicate events stay safe but do not hide a later independent reset. */
it("accepts repeated resets without permanent kind dedupe", async () => {
  await mount();
  await act(async () => emit({ kind: "app_reset" }));
  await waitFor(() => expect(data.busy).toBe(false));
  await act(async () => emit({ kind: "app_reset" }));
  await waitFor(() => expect(data.busy).toBe(false));
  expect(fake.clear).toHaveBeenCalledTimes(2);
  expect(data.resetEpoch).toBe(2);
});
/** Listener failure exposes a retry and explicit result-based operation fallback. */
it("offers listener retry without replaying commands", async () => {
  vi.mocked(ipc.onDataChanged).mockRejectedValueOnce(new Error("native unavailable"));
  render(
    <DataManagementHost>
      <Probe />
    </DataManagementHost>,
  );
  await screen.findByRole("button", { name: "Retry live updates" });
  expect(data.listenerStatus).toBe("error");
  fireEvent.click(screen.getByRole("button", { name: "Retry live updates" }));
  await waitFor(() => expect(data.listenerStatus).toBe("ready"));
  expect(ipc.prepareResetXwork).not.toHaveBeenCalled();
});
/** A delayed native listener cannot survive host disposal. */
it("unlistens a registration resolved after unmount", async () => {
  let resolve!: (remove: () => void) => void;
  const remove = vi.fn();
  vi.mocked(ipc.onDataChanged).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = render(
    <DataManagementHost>
      <Probe />
    </DataManagementHost>,
  );
  view.unmount();
  await act(async () => resolve(remove));
  expect(remove).toHaveBeenCalledOnce();
});
/** A commit event keeps apply locked through a late response and carries no cleanup count. */
it("reconciles event-first reset once and keeps command lock", async () => {
  await mount();
  let resolve!: (result: Awaited<ReturnType<typeof ipc.confirmResetXwork>>) => void;
  vi.mocked(ipc.confirmResetXwork).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  await act(() => data.prepare("reset"));
  act(() => data.setConfirmation("RESET"));
  let pending!: Promise<void>;
  act(() => {
    pending = data.confirm();
  });
  await waitFor(() => expect(ipc.confirmResetXwork).toHaveBeenCalledOnce());
  await act(async () => emit({ kind: "app_reset" }));
  expect(data.busy).toBe(true);
  expect(fake.release).not.toHaveBeenCalled();
  expect(screen.queryByText(/Some saved credentials/)).toBeNull();
  await act(async () => {
    resolve({
      projectsRemoved: 0,
      customCliProfilesRemoved: 0,
      keyboardShortcutOverridesRemoved: 0,
      settingsReset: true,
      notesRemoved: 0,
      eventsRemoved: 0,
      sessionsStopped: 0,
      credentialCleanupPending: 2,
    });
    await pending;
  });
  expect(fake.clear).toHaveBeenCalledOnce();
  expect(fake.release).toHaveBeenCalledOnce();
  expect(screen.getByText(/Some saved credentials/)).toBeVisible();
});

/** Hiding the window retires only unconfirmed Data requests. */
it("retires preview while hidden and keeps reset focus pending until visible", async () => {
  await mount();
  await act(() => data.prepare("reset"));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(data.phase).toBe("idle"));
  expect(ipc.cancelDataOperation).toHaveBeenCalledWith(1);
  await act(async () => emit({ kind: "app_reset" }));
  await waitFor(() => expect(data.busy).toBe(false));
  expect(screen.getByRole("heading", { name: "Home" })).not.toHaveFocus();
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("heading", { name: "Home" })).toHaveFocus();
  hidden.mockRestore();
});
