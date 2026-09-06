import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetProjectsStore } from "@/features/projects/projects-store";
import { resetSessionsStore } from "@/features/sessions/sessions-store";
import { resetCliProfilesStore } from "@/features/settings/cli-profiles-store";
import { createCliProfilesSnapshot } from "@/features/settings/cli-profiles-test-fixture";
import { useDataManagement } from "@/features/settings/data-management-provider";
import type { DataManagementState } from "@/features/settings/data-management-state";
import { resetSettingsStore } from "@/features/settings/settings-store";
import { createSettingsSnapshot } from "@/features/settings/settings-test-fixture";
import { getCliProfiles } from "@/lib/ipc/cli-profiles";
import * as dataIpc from "@/lib/ipc/data-management";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { listSessions } from "@/lib/ipc/sessions";
import { getSettings } from "@/lib/ipc/settings";
import { DataManagementBridge, DataManagementHost } from "./data-management-bridge";
import { HomeEntry } from "./home-entry";
import { resetQuitStore, useQuitStore } from "./quit-store";

// Renderer and shortcut collaborators stay isolated; router, provider and owner stores are real.
const fake = vi.hoisted(() => ({
  clear: vi.fn(),
  reconcile: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  settle: vi.fn(async () => {}),
  release: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
}));
vi.mock("@/features/terminal", () => ({
  useTerminalDataBoundary: () => ({
    clearAfterReset: fake.clear,
    reconcileAfterResetFailure: fake.reconcile,
  }),
}));
vi.mock("@/features/settings/keyboard-shortcuts-provider", () => ({
  useKeyboardShortcuts: () => ({
    refreshAfterDataChange: fake.refresh,
    settleBeforeDataChange: fake.settle,
    releaseDataChangeBarrier: fake.release,
  }),
}));
vi.mock("@/lib/ipc/projects", () => ({
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
  addProject: vi.fn(),
}));
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
vi.mock("@/lib/ipc/data-management", () => ({
  onDataChanged: vi.fn(async () => () => {}),
  prepareResetXwork: vi.fn(),
  confirmResetXwork: vi.fn(),
  cancelDataOperation: vi.fn(),
  exportBackup: vi.fn(),
}));
const PROJECT: ProjectDto = {
  id: "p",
  displayName: "Before",
  rootPath: "C:/fixtures/p",
  isPinned: false,
  addedAtMs: 1,
  lastOpenedAtMs: 1,
  availability: { status: "available" },
};
const SESSION: SessionSummaryDto = {
  id: "s",
  projectId: "p",
  name: "Surviving session",
  status: "running",
  runningProcessCount: 1,
  tabCount: 1,
};
let data: DataManagementState;
/** Control a query or operation completion without a live OS resource. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Capture the provider's public API and a persistent child lifetime through real navigation. */
function Probe() {
  data = useDataManagement();
  useEffect(() => {
    fake.mounts();
    return () => {
      fake.unmounts();
    };
  }, []);
  return (
    <>
      <Link to="/">Go Home</Link>
      <Link to="/settings">Go Settings</Link>
      <DataManagementBridge />
      <Outlet />
    </>
  );
}
/** Compose one real host above route children as the application shell does. */
function Host() {
  return (
    <TooltipProvider>
      <DataManagementHost>
        <Probe />
      </DataManagementHost>
    </TooltipProvider>
  );
}
/** Create actual memory history and owner callbacks rather than mocking useNavigate. */
async function mount(path = "/") {
  const router = createMemoryRouter(
    [
      {
        element: <Host />,
        children: [
          { path: "/", element: <HomeEntry /> },
          { path: "/settings", element: <h1>Settings fixture</h1> },
          { path: "/projects/:id", element: <h1>Project destination</h1> },
          { path: "/sessions/:id", element: <h1>Session destination</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(data.listenerStatus).toBe("ready"));
  return { ...view, router };
}
// Establish complete DTOs and clean public stores before each isolated app composition.
beforeEach(() => {
  vi.clearAllMocks();
  resetProjectsStore();
  resetSessionsStore();
  resetSettingsStore();
  resetCliProfilesStore();
  resetQuitStore();
  vi.mocked(listProjects).mockReset().mockResolvedValue([PROJECT]);
  vi.mocked(listSessions).mockReset().mockResolvedValue([SESSION]);
  vi.mocked(getSettings).mockResolvedValue(createSettingsSnapshot());
  vi.mocked(getCliProfiles).mockResolvedValue(createCliProfilesSnapshot());
  vi.mocked(dataIpc.prepareResetXwork).mockResolvedValue({
    requestId: 1,
    projects: 1,
    customCliProfiles: 0,
    keyboardShortcutOverrides: 0,
    settingsDifferFromDefault: false,
    notes: 0,
    events: 0,
    sessions: 1,
    runningProcesses: 1,
    unsavedDocuments: 0,
  });
});
// Release all listeners and stores; no real profile is ever initialized.
afterEach(() => {
  cleanup();
  resetProjectsStore();
  resetSessionsStore();
  resetSettingsStore();
  resetCliProfilesStore();
  resetQuitStore();
  vi.restoreAllMocks();
});

// Unrelated context snapshots do not replace the query owner or cause an effect loop.
it("keeps query and operation identities stable on unrelated provider updates", async () => {
  await mount();
  await screen.findByRole("link", { name: "Open session Surviving session" });
  const getCurrent = data.getCurrent;
  const calls = vi.mocked(listProjects).mock.calls.length;
  act(() => data.setListenerStatus("error"));
  act(() => data.setListenerStatus("ready"));
  expect(data.getCurrent).toBe(getCurrent);
  expect(listProjects).toHaveBeenCalledTimes(calls);
  expect(fake.mounts).toHaveBeenCalledOnce();
  expect(fake.unmounts).not.toHaveBeenCalled();
});
// A deferred operation lives above navigation and is neither restarted nor cancelled by it.
it("preserves a deferred operation through Home Settings Home navigation", async () => {
  const pending = deferred<Awaited<ReturnType<typeof dataIpc.exportBackup>>>();
  vi.mocked(dataIpc.exportBackup).mockReturnValueOnce(pending.promise);
  const { router } = await mount();
  await screen.findByRole("link", { name: "Open project Before" });
  const identity = data.getCurrent;
  let work!: Promise<void>;
  act(() => {
    work = data.prepare("export");
  });
  await act(async () => router.navigate("/settings"));
  await act(async () => router.navigate("/"));
  expect(data.busy).toBe(true);
  expect(data.getCurrent).toBe(identity);
  expect(dataIpc.exportBackup).toHaveBeenCalledOnce();
  expect(dataIpc.cancelDataOperation).not.toHaveBeenCalled();
  expect(dataIpc.onDataChanged).toHaveBeenCalledOnce();
  expect(fake.mounts).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve({ kind: "cancelled" });
    await work;
  });
  expect(await screen.findByRole("link", { name: "Open project Before" })).toBeInTheDocument();
});
// A reset on the same index route clears old local snapshots even when owner reads fail.
it("keeps Home mounted through reset and never revives rows after failed reads", async () => {
  const { router } = await mount();
  await screen.findByRole("link", { name: "Open session Surviving session" });
  const identity = data.getCurrent;
  vi.mocked(listProjects).mockRejectedValue(
    new IpcCallError("list_projects", { code: "persistenceFailed" }),
  );
  vi.mocked(listSessions).mockResolvedValue([]);
  await act(async () => data.acceptCommitted("app_reset"));
  await screen.findByText("XWork couldn't load your projects.");
  expect(screen.queryByRole("link", { name: "Open project Before" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Open session Surviving session" })).toBeNull();
  expect(router.state.location.pathname).toBe("/");
  expect(data.getCurrent).toBe(identity);
  expect(fake.clear).toHaveBeenCalledOnce();
  expect(fake.unmounts).not.toHaveBeenCalled();
});
// Import refreshes Home labels while leaving terminal owner identity and runtime intact.
it("refreshes imported metadata without clearing the terminal collaborator", async () => {
  await mount();
  await screen.findByRole("link", { name: "Open session Surviving session" });
  vi.mocked(listProjects).mockResolvedValue([{ ...PROJECT, displayName: "Imported" }]);
  await act(async () => data.acceptCommitted("backup_imported"));
  expect(await screen.findByRole("link", { name: "Open project Imported" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open session Surviving session" })).toBeInTheDocument();
  expect(fake.clear).not.toHaveBeenCalled();
  expect(fake.unmounts).not.toHaveBeenCalled();
});
// A reset from Settings navigates through the same host to an authoritative Welcome response.
it("returns from Settings to Welcome after reset", async () => {
  const { router } = await mount("/settings");
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(listSessions).mockResolvedValue([]);
  await act(async () => data.acceptCommitted("app_reset"));
  await screen.findByRole("button", { name: "Add Project" });
  expect(router.state.location.pathname).toBe("/");
  expect(fake.clear).toHaveBeenCalledOnce();
});
// Live state rejects a click in the same turn as commit, before rendering its new epoch.
it("blocks a stale link synchronously at commit", async () => {
  const { router } = await mount();
  const row = await screen.findByRole("link", { name: "Open project Before" });
  let work!: Promise<void>;
  act(() => {
    work = data.acceptCommitted("backup_imported");
    fireEvent.click(row);
  });
  await act(async () => work);
  expect(router.state.location.pathname).toBe("/");
});
// Deferred pre-reset project and session responses cannot resurrect their old generation.
it("drops both pre-reset responses after replacement queries complete", async () => {
  await mount();
  await screen.findByRole("link", { name: "Open session Surviving session" });
  const oldProjects = deferred<ProjectDto[]>();
  const oldSessions = deferred<SessionSummaryDto[]>();
  vi.mocked(listProjects).mockReturnValueOnce(oldProjects.promise).mockResolvedValue([]);
  vi.mocked(listSessions).mockReturnValueOnce(oldSessions.promise).mockResolvedValue([]);
  act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => data.acceptCommitted("app_reset"));
  await screen.findByRole("button", { name: "Add Project" });
  await act(async () => {
    oldProjects.resolve([PROJECT]);
    oldSessions.resolve([SESSION]);
  });
  expect(screen.queryByRole("link", { name: "Open project Before" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Open session Surviving session" })).toBeNull();
});
// Quit suspends reads/navigation and idle resumption obtains fresh snapshots.
it("suspends Home during Quit and resumes after cancellation", async () => {
  const { router } = await mount();
  const link = await screen.findByRole("link", { name: "Open project Before" });
  act(() => useQuitStore.setState({ phase: "requesting" }));
  const reads = vi.mocked(listProjects).mock.calls.length;
  fireEvent.click(link);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(router.state.location.pathname).toBe("/");
  expect(listProjects).toHaveBeenCalledTimes(reads);
  act(() => useQuitStore.setState({ phase: "idle" }));
  await waitFor(() => expect(vi.mocked(listProjects).mock.calls.length).toBeGreaterThan(reads));
});
// Uncertain reset reconciles surviving runtime and never claims it was cleared.
it("shows surviving runtime after an uncertain reset", async () => {
  vi.mocked(dataIpc.confirmResetXwork).mockRejectedValueOnce(
    new IpcCallError("confirm_reset_xwork", null),
  );
  await mount();
  await screen.findByRole("link", { name: "Open session Surviving session" });
  await act(async () => data.prepare("reset"));
  act(() => data.setConfirmation("RESET"));
  await act(async () => data.confirm());
  expect(data.phase).toBe("uncertain");
  expect(
    await screen.findByRole("link", { name: "Open session Surviving session" }),
  ).toBeInTheDocument();
  expect(fake.clear).not.toHaveBeenCalled();
  expect(fake.reconcile).toHaveBeenCalledOnce();
});
// Empty projects keep the Sessions query disabled even after a project event registration.
it("does not query sessions for Welcome", async () => {
  vi.mocked(listProjects).mockResolvedValue([]);
  await mount();
  await screen.findByRole("button", { name: "Add Project" });
  expect(listSessions).not.toHaveBeenCalled();
  expect(onProjectsChanged).toHaveBeenCalledOnce();
});
