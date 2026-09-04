// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDetailDto, SessionRuntimeEventDto } from "@/bindings/sessions/sessions";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as cliProfilesIpc from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { resetRecentTools } from "./recent-tools-store";
import { SessionRoute } from "./session-route";
import {
  createCloseImpact,
  createNonEmptySessionDetail,
  createProjectDto,
  createRuntimeEvent,
  createSessionDetail,
  createSessionSummary,
  FIXTURE_ROOT_PATH,
  FIXTURE_SESSION_ID,
} from "./sessions-test-fixture";

// Replace both boundaries so no case reaches Tauri.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  getCloseImpact: vi.fn(),
  getSession: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
  renameSession: vi.fn(),
  selectSessionTool: vi.fn(),
  setObservedSession: vi.fn(),
}));
vi.mock("@/lib/ipc/projects", () => ({
  getProject: vi.fn(),
  onProjectsChanged: vi.fn(),
}));
vi.mock("@/lib/ipc/cli-profiles", () => ({
  checkCliProfile: vi.fn(),
  getCliProfiles: vi.fn(),
  onCliProfilesChanged: vi.fn(),
}));

const getSessionMock = vi.mocked(sessionsIpc.getSession);
const renameSessionMock = vi.mocked(sessionsIpc.renameSession);
const getCloseImpactMock = vi.mocked(sessionsIpc.getCloseImpact);
const closeRuntimeTargetMock = vi.mocked(sessionsIpc.closeRuntimeTarget);
const onRuntimeChangedMock = vi.mocked(sessionsIpc.onSessionsRuntimeChanged);
const setObservedSessionMock = vi.mocked(sessionsIpc.setObservedSession);
const getProjectMock = vi.mocked(projectsIpc.getProject);
const selectSessionToolMock = vi.mocked(sessionsIpc.selectSessionTool);
const getCliProfilesMock = vi.mocked(cliProfilesIpc.getCliProfiles);

/** One available built-in profile, so the picker always has a card to render. */
const CODEX_PROFILE = {
  id: "builtin:codex",
  name: "Codex",
  kind: "builtIn" as const,
  command: "codex",
  arguments: [] as string[],
  shellId: null,
  effectiveShellId: "pwsh",
  icon: "Cx",
  color: "#10a37f",
  environment: [],
  availability: { status: "available" as const, checkedAtUnixMs: "1700000000000" },
};

/** Build one promise a case settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Deliver one runtime event exactly as the adapter would. */
function emit(event: SessionRuntimeEventDto): void {
  const handler = onRuntimeChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The route should have registered a runtime-changed handler.");
  }
  act(() => handler(event));
}

/** Render the real route with a destination for each navigation it can perform. */
function renderRoute(sessionId = FIXTURE_SESSION_ID) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/sessions/${sessionId}`]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionRoute />} />
          <Route path="/projects" element={<p>Projects destination</p>} />
          <Route path="/projects/:projectId" element={<p>Overview destination</p>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Open the session header's actions menu. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "More actions" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(createSessionDetail());
  getProjectMock.mockResolvedValue(createProjectDto());
  onRuntimeChangedMock.mockResolvedValue(() => {});
  vi.mocked(projectsIpc.onProjectsChanged).mockResolvedValue(() => {});
  setObservedSessionMock.mockResolvedValue(null);
  renameSessionMock.mockResolvedValue(createSessionDetail());
  getCloseImpactMock.mockResolvedValue(createCloseImpact());
  closeRuntimeTargetMock.mockResolvedValue({
    target: { kind: "session", sessionId: FIXTURE_SESSION_ID },
    session: null,
  });
  selectSessionToolMock.mockResolvedValue(createNonEmptySessionDetail());
  getCliProfilesMock.mockResolvedValue({
    revision: "1",
    defaultShellId: "system",
    effectiveDefaultShellId: "pwsh",
    shells: [],
    profiles: [CODEX_PROFILE],
  });
  vi.mocked(cliProfilesIpc.onCliProfilesChanged).mockResolvedValue(() => {});
  resetRecentTools();
});

afterEach(() => {
  cleanup();
  resetRecentTools();
});

describe("SessionRoute states", () => {
  // Verify the first read shows only the non-interactive shape, with no action control.
  it("renders the loading skeleton without action controls", () => {
    const pending = deferred<SessionDetailDto>();
    getSessionMock.mockReturnValue(pending.promise);

    renderRoute();

    expect(screen.getByRole("status", { name: "Loading session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();

    pending.resolve(createSessionDetail());
  });

  // Verify a load failure replaces the content and its retry reads the same session again.
  it("renders and retries a load failure", async () => {
    const user = userEvent.setup();
    getSessionMock.mockRejectedValueOnce(
      new IpcCallError("get_session", { code: "unauthorizedWindow" }),
    );

    renderRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("XWork couldn't open this session.");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("New Session");
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  // Verify the header states the session name and the root its tools will start in.
  it("renders the header with the project root", async () => {
    renderRoute();

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("New Session");
    expect(heading).toHaveAttribute("title", "New Session");
    expect(await screen.findByText(FIXTURE_ROOT_PATH)).toBeInTheDocument();
  });

  // Verify a project that cannot be read hides the path instead of showing a wrong one.
  it("hides the root path when the project cannot be read", async () => {
    getProjectMock.mockRejectedValue(
      new IpcCallError("get_project", { code: "projectLookupFailed" }),
    );

    renderRoute();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByText(/Starts in/)).not.toBeInTheDocument();
  });

  // Verify a session that already has tabs renders only the explicit FE-007 placeholder.
  it("renders the FE-007 placeholder for a session with tabs", async () => {
    getSessionMock.mockResolvedValue(createNonEmptySessionDetail());

    renderRoute();

    expect(await screen.findByText("This session has 1 tab.")).toBeInTheDocument();
    expect(screen.getByText("Tabs and panes arrive with FE-007.")).toBeInTheDocument();
    // The header stays in both branches at this slice, so rename and delete always have a
    // way in even once a session has tabs.
    expect(screen.getByRole("button", { name: "Rename session" })).toBeInTheDocument();
  });

  // Verify the placeholder pluralizes the count it reads from the snapshot.
  it("pluralizes the tab count", async () => {
    const detail = createNonEmptySessionDetail();
    const firstTab = detail.tabs[0];
    if (firstTab === undefined) {
      throw new Error("The non-empty fixture should carry one tab.");
    }
    getSessionMock.mockResolvedValue({
      ...detail,
      tabs: [firstTab, { ...firstTab, id: "tab-2" }],
      summary: createSessionSummary({ status: "running", tabCount: 2 }),
    });

    renderRoute();

    expect(await screen.findByText("This session has 2 tabs.")).toBeInTheDocument();
  });
});

describe("SessionRoute missing session", () => {
  // Verify a session that never existed leaves for the project list, because no project is
  // known at that point.
  it("navigates to the project list when the session is unknown", async () => {
    getSessionMock.mockRejectedValue(
      new IpcCallError("get_session", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }),
    );

    renderRoute();

    expect(await screen.findByText("Projects destination")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Verify a deleted event for the open session returns to its project silently.
  it("navigates to the project after a deleted event", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1 });

    emit(
      createRuntimeEvent({
        revision: "11",
        change: "deleted",
        sessionId: FIXTURE_SESSION_ID,
        summary: null,
      }),
    );

    expect(await screen.findByText("Overview destination")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Verify a deleted event closes an open dialog on the way out, so no control for a session
  // that no longer exists is left on screen.
  it("closes an open dialog when the session disappears", async () => {
    const user = userEvent.setup();
    renderRoute();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));
    await screen.findByRole("dialog");

    emit(
      createRuntimeEvent({
        revision: "11",
        change: "deleted",
        sessionId: FIXTURE_SESSION_ID,
        summary: null,
      }),
    );

    expect(await screen.findByText("Overview destination")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SessionRoute observation", () => {
  // Verify the route records exactly the session it shows, and clears it once on the way out.
  it("observes on entry and clears on exit", async () => {
    const view = renderRoute();
    await screen.findByRole("heading", { level: 1 });

    expect(setObservedSessionMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID);

    view.unmount();

    expect(setObservedSessionMock).toHaveBeenCalledTimes(2);
    expect(setObservedSessionMock).toHaveBeenLastCalledWith(null);
  });

  // Verify a refused observation never stops the route from rendering the session.
  it("renders the session even when the observation is refused", async () => {
    setObservedSessionMock.mockRejectedValue(
      new IpcCallError("set_observed_session", { code: "runtimeShuttingDown" }),
    );

    renderRoute();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("New Session");
  });
});

describe("SessionRoute live updates", () => {
  // Verify a rename committed elsewhere reaches the header without a navigation.
  it("follows a renamed session in place", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1 });

    emit(
      createRuntimeEvent({
        revision: "11",
        change: "updated",
        summary: createSessionSummary({ name: "Renamed elsewhere" }),
      }),
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Renamed elsewhere");
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a dropped event re-reads the whole session rather than patching it.
  it("re-reads the session after a revision gap", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1 });
    getSessionMock.mockResolvedValue(
      createSessionDetail({
        summary: createSessionSummary({ name: "Reloaded" }),
        revision: "30",
      }),
    );

    emit(createRuntimeEvent({ revision: "20", change: "updated" }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Reloaded");
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });
});

describe("SessionRoute rename", () => {
  // Verify the header's own icon button opens the dialog prefilled.
  it("opens the rename dialog from the header button", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(await screen.findByRole("button", { name: "Rename session" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Rename session" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Session name")).toHaveValue("New Session");
  });

  // Verify the menu entry opens the same dialog.
  it("opens the rename dialog from the menu", async () => {
    const user = userEvent.setup();
    renderRoute();
    await openMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // Verify an invalid name never reaches the backend.
  it("blocks a whitespace-only name before the command", async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "Rename session" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "  ");

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(renameSessionMock).not.toHaveBeenCalled();
  });

  // Verify a successful rename sends the trimmed name, closes the dialog, and returns focus
  // to the icon button that opened it.
  it("renames and returns focus to the header button", async () => {
    const user = userEvent.setup();
    renderRoute();
    const renameButton = await screen.findByRole("button", { name: "Rename session" });
    await user.click(renameButton);

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "  Renamed  {Enter}");

    expect(renameSessionMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID, "Renamed");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await vi.waitFor(() => expect(renameButton).toHaveFocus());
  });

  // Verify a backend name refusal keeps the dialog open with the rule.
  it("keeps the dialog open after invalidName", async () => {
    const user = userEvent.setup();
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "invalidName" }),
    );
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "Rename session" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use 1 to 80 characters without control characters.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Verify renaming a session that vanished leaves the route instead of showing an error.
  it("leaves the route when the renamed session is gone", async () => {
    const user = userEvent.setup();
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", {
        code: "sessionNotFound",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    getSessionMock
      .mockResolvedValueOnce(createSessionDetail())
      .mockRejectedValue(
        new IpcCallError("get_session", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }),
      );
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "Rename session" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("SessionRoute delete", () => {
  /** Open the confirmation from the header menu. */
  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete Session" }));
    return screen.findByRole("dialog");
  }

  // Verify the impact is read before the confirmation appears, and names the session.
  it("reads the impact before the confirmation opens", async () => {
    const user = userEvent.setup();
    renderRoute();

    const dialog = await openDeleteDialog(user);

    expect(getCloseImpactMock).toHaveBeenCalledExactlyOnceWith({
      kind: "session",
      sessionId: FIXTURE_SESSION_ID,
    });
    expect(
      within(dialog).getByRole("heading", { name: "Delete session “New Session”?" }),
    ).toBeInTheDocument();
  });

  // Verify cancelling sends no destructive command and returns focus to the menu trigger.
  it("cancels without calling a command", async () => {
    const user = userEvent.setup();
    renderRoute();
    const trigger = await screen.findByRole("button", { name: "More actions" });
    await openDeleteDialog(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(closeRuntimeTargetMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  // Verify a confirmed delete returns to the project the session belonged to.
  it("deletes the session and returns to its project", async () => {
    const user = userEvent.setup();
    renderRoute();
    await openDeleteDialog(user);

    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(closeRuntimeTargetMock).toHaveBeenCalledExactlyOnceWith(
      { kind: "session", sessionId: FIXTURE_SESSION_ID },
      true,
    );
    expect(await screen.findByText("Overview destination")).toBeInTheDocument();
  });

  // Verify a blocker that appeared at commit time re-renders the refreshed facts and asks
  // for one more explicit confirmation before anything is closed.
  it("re-asks with refreshed facts after confirmationRequired", async () => {
    const user = userEvent.setup();
    closeRuntimeTargetMock.mockRejectedValueOnce(
      new IpcCallError("close_runtime_target", {
        code: "confirmationRequired",
        impact: createCloseImpact({
          runningProcessCount: 1,
          runningProcessLabels: ["claude"],
        }),
      }),
    );
    renderRoute();
    await openDeleteDialog(user);

    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(
      await screen.findByText("1 running process will be stopped: claude"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(closeRuntimeTargetMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Overview destination")).toBeInTheDocument();
  });

  // Verify a cleanup failure keeps the confirmation open with one more attempt.
  it("keeps the confirmation open after a cleanup failure", async () => {
    const user = userEvent.setup();
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", {
        code: "contentLifecycleFailed",
        operation: "close",
        targetId: FIXTURE_SESSION_ID,
      }),
    );
    renderRoute();
    await openDeleteDialog(user);

    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "XWork couldn't stop everything in this session.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // Verify a failed impact read still opens the confirmation and lets the user ask again.
  it("opens the confirmation after a failed impact read", async () => {
    const user = userEvent.setup();
    getCloseImpactMock.mockRejectedValueOnce(
      new IpcCallError("get_close_impact", {
        code: "contentLifecycleFailed",
        operation: "inspect",
        targetId: FIXTURE_SESSION_ID,
      }),
    );
    renderRoute();

    const dialog = await openDeleteDialog(user);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "XWork couldn't check what this session is running.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(getCloseImpactMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Delete Session" })).toBeInTheDocument();
  });

  // Verify a vanished session opens no confirmation at all.
  it("opens no confirmation when the session is gone", async () => {
    const user = userEvent.setup();
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", {
        code: "sessionNotFound",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    renderRoute();
    await openMenu(user);

    await user.click(await screen.findByRole("menuitem", { name: "Delete Session" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(closeRuntimeTargetMock).not.toHaveBeenCalled();
  });
});

describe("SessionRoute content branches", () => {
  // Verify an empty session renders the whole tool picker, which is the branch FE-006 owns.
  it("renders the tool picker for an empty session", async () => {
    renderRoute();

    expect(await screen.findByRole("heading", { name: "All tools" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Codex/ })).toBeInTheDocument();
    expect(screen.queryByText(/Tabs and panes arrive with FE-007/)).not.toBeInTheDocument();
  });

  // Verify selecting a tool switches the route to its other branch from the returned
  // snapshot alone, with no second read and no process started.
  it("switches branch from the returned snapshot", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(selectSessionToolMock).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_SESSION_ID,
      "builtin:codex",
    );
    expect(await screen.findByText("This session has 1 tab.")).toBeInTheDocument();
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a session filled up elsewhere re-reads instead of showing the user a failure.
  it("re-reads the session after sessionNotEmpty", async () => {
    const user = userEvent.setup();
    selectSessionToolMock.mockRejectedValue(
      new IpcCallError("select_session_tool", { code: "sessionNotEmpty" }),
    );
    getSessionMock
      .mockResolvedValueOnce(createSessionDetail())
      .mockResolvedValue(createNonEmptySessionDetail());
    renderRoute();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByText("This session has 1 tab.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Verify a session that vanished mid-selection leaves the route silently.
  it("leaves the route after sessionNotFound during a selection", async () => {
    const user = userEvent.setup();
    selectSessionToolMock.mockRejectedValue(
      new IpcCallError("select_session_tool", {
        code: "sessionNotFound",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    getSessionMock.mockResolvedValueOnce(createSessionDetail()).mockRejectedValue(
      new IpcCallError("get_session", {
        code: "sessionNotFound",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    renderRoute();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByText("Overview destination")).toBeInTheDocument();
  });

  // Verify a catalog failure stays inside the picker and leaves the header intact.
  it("keeps a catalog failure inside the picker", async () => {
    getCliProfilesMock.mockRejectedValue(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );
    renderRoute();

    expect(await screen.findByText("XWork couldn't load your CLI profiles.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
  });

  // Verify a number key is ignored while a dialog owns the focus context, so the picker
  // never selects a tool the user could not see they were choosing.
  it("ignores a number key while a dialog is open", async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "Rename session" }));
    await screen.findByRole("dialog");

    await user.keyboard("1");

    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });
});
