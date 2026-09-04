// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatusDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { ProjectSessionList } from "./project-session-list";
import { resetProjectSessions } from "./use-project-sessions";

// Replace the whole Sessions boundary so no case reaches Tauri.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  createSession: vi.fn(),
  getCloseImpact: vi.fn(),
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
  renameSession: vi.fn(),
}));

const listSessionsMock = vi.mocked(sessionsIpc.listSessions);
const renameSessionMock = vi.mocked(sessionsIpc.renameSession);
const getCloseImpactMock = vi.mocked(sessionsIpc.getCloseImpact);
const closeRuntimeTargetMock = vi.mocked(sessionsIpc.closeRuntimeTarget);

const PROJECT_ID = "p1";

/** Build one summary of the project under test. */
function summary(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    id: "s1",
    projectId: PROJECT_ID,
    name: "Debounce PTY resize",
    status: "noToolYet",
    runningProcessCount: 0,
    tabCount: 0,
    ...overrides,
  };
}

/** Report the current router path so a navigation can be asserted. */
function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

/** Create intent recorded by the cases that press the empty-state entry point. */
const onCreateSession = vi.fn();

/** Render the block at one router entry with the project availability a case chooses. */
function renderList(isProjectUnavailable = false) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectSessionList
          projectId={PROJECT_ID}
          isProjectUnavailable={isProjectUnavailable}
          onCreateSession={onCreateSession}
        />
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Build one promise a case settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectSessions();
  onCreateSession.mockReset();
  listSessionsMock.mockResolvedValue([]);
  vi.mocked(sessionsIpc.onSessionsRuntimeChanged).mockResolvedValue(() => {});
  renameSessionMock.mockResolvedValue({
    summary: summary(),
    tabs: [],
    activeTabId: null,
    canReopenLastClosedTab: false,
    revision: "3",
  });
  getCloseImpactMock.mockResolvedValue({
    target: { kind: "session", sessionId: "s1" },
    requiresConfirmation: true,
    runningProcessCount: 0,
    runningProcessLabels: [],
    unsavedFileCount: 0,
    unsavedFileLabels: [],
  });
  closeRuntimeTargetMock.mockResolvedValue({
    target: { kind: "session", sessionId: "s1" },
    session: null,
  });
});

afterEach(() => {
  cleanup();
  resetProjectSessions();
});

describe("ProjectSessionList states", () => {
  // Verify the block always states its own lifetime, which is the only warning before Quit.
  it("names the block and its lifetime", async () => {
    renderList();

    expect(
      await screen.findByRole("heading", { name: "Sessions in this run" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not restored after Quit")).toBeInTheDocument();
  });

  // Verify the first read shows placeholder rows rather than a false empty state.
  it("shows placeholder rows while the first read is pending", () => {
    const pending = deferred<SessionSummaryDto[]>();
    listSessionsMock.mockReturnValue(pending.promise);

    renderList();

    expect(screen.getByLabelText("Loading sessions")).toBeInTheDocument();
    expect(screen.queryByText("No sessions in this run yet.")).not.toBeInTheDocument();

    pending.resolve([]);
  });

  // Verify the empty state carries both sentences and its own entry point.
  it("renders the empty state with its own New Session control", async () => {
    renderList();

    expect(await screen.findByText("No sessions in this run yet.")).toBeInTheDocument();
    expect(screen.getByText("Start one to work in this project.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Session" })).toBeInTheDocument();
  });

  // Verify the empty-state control raises the route's shared create flow.
  it("raises the shared create flow from the empty state", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("No sessions in this run yet.");

    await user.click(screen.getByRole("button", { name: "New Session" }));

    expect(onCreateSession).toHaveBeenCalledOnce();
  });

  // Verify an unavailable project blocks the empty-state control and says why.
  it("blocks the empty-state control for an unavailable project", async () => {
    const user = userEvent.setup();
    renderList(true);
    await screen.findByText("No sessions in this run yet.");

    const entry = screen.getByRole("button", { name: "New Session" });
    expect(entry).toHaveAttribute("aria-disabled", "true");

    await user.hover(entry);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The project folder is unavailable.",
    );

    await user.click(entry);
    expect(onCreateSession).not.toHaveBeenCalled();
  });

  // Verify a failed read explains itself inside the block and offers one more attempt.
  it("offers Try again after a failed read", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );

    renderList();

    expect(
      await screen.findByText("XWork couldn't load sessions for this project."),
    ).toBeInTheDocument();

    listSessionsMock.mockResolvedValue([summary()]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTitle("Debounce PTY resize")).toBeInTheDocument();
  });
});

describe("ProjectSessionList rows", () => {
  // Verify every status is readable as text and drives its own meta line.
  it.each<[SessionStatusDto, string]>([
    ["noToolYet", "No tool chosen · 0 tabs"],
    ["running", "Running · 0 tabs"],
    ["unseenOutput", "New output · 0 tabs"],
    ["needsAttention", "Needs attention · 0 tabs"],
    ["finished", "Finished · 0 tabs"],
    ["exitedWithError", "Exited with an error · 0 tabs"],
  ])("renders the %s meta line", async (status, meta) => {
    listSessionsMock.mockResolvedValue([summary({ status })]);

    renderList();

    expect(await screen.findByText(meta)).toBeInTheDocument();
  });

  // Verify a running session states its process count too.
  it("states the running process count", async () => {
    listSessionsMock.mockResolvedValue([
      summary({ status: "running", tabCount: 1, runningProcessCount: 2 }),
    ]);

    renderList();

    expect(await screen.findByText("Running · 1 tab · 2 processes")).toBeInTheDocument();
  });

  // Verify the status label stays readable even though the row only shows a dot.
  it("announces the status as hidden text", async () => {
    listSessionsMock.mockResolvedValue([summary({ status: "needsAttention" })]);

    renderList();

    expect(await screen.findByText("Needs attention")).toHaveClass("sr-only");
  });

  // Verify a long name is clipped while the full value stays reachable.
  it("offers the full name as a title", async () => {
    const name = "A session name far longer than the overview row can ever show at once";
    listSessionsMock.mockResolvedValue([summary({ name })]);

    renderList();

    expect(await screen.findByTitle(name)).toHaveTextContent(name);
  });

  // Verify the rows keep the exact order the backend returned.
  it("renders the rows in backend order", async () => {
    listSessionsMock.mockResolvedValue([
      summary({ id: "s1", name: "First" }),
      summary({ id: "s2", name: "Second" }),
    ]);

    renderList();
    await screen.findByTitle("First");

    expect(
      screen.getAllByRole("link", { name: "Open" }).map((l) => l.getAttribute("href")),
    ).toEqual(["/sessions/s1", "/sessions/s2"]);
  });

  // Verify both the row itself and the Open control lead to that session.
  it.each([
    ["the row", /^First/],
    ["the Open control", /^Open$/],
  ])("opens the session from %s", async (_label, name) => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary({ id: "s1", name: "First" })]);

    renderList();
    await user.click(await screen.findByRole("link", { name }));

    expect(screen.getByTestId("path")).toHaveTextContent("/sessions/s1");
  });
});

describe("ProjectSessionList rename", () => {
  // Verify the menu opens the rename dialog prefilled with the current name.
  it("prefills the rename dialog", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await user.click(
      await screen.findByRole("button", { name: "More actions for Debounce PTY resize" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Rename session" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Session name")).toHaveValue("Debounce PTY resize");
  });

  // Verify an invalid name never reaches the backend.
  it("blocks a whitespace-only name before the command", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await user.click(
      await screen.findByRole("button", { name: "More actions for Debounce PTY resize" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "   ");

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(
      screen.getByText("Use 1 to 80 characters without control characters."),
    ).toBeInTheDocument();
    expect(renameSessionMock).not.toHaveBeenCalled();
  });

  // Verify a successful rename sends the trimmed name, closes the dialog, and hands focus
  // back to the menu that opened it.
  it("renames and restores focus", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const trigger = await screen.findByRole("button", {
      name: "More actions for Debounce PTY resize",
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "  Renamed  {Enter}");

    expect(renameSessionMock).toHaveBeenCalledExactlyOnceWith("s1", "Renamed");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  // Verify a backend name refusal keeps the dialog open with the rule.
  it("keeps the dialog open after invalidName", async () => {
    const user = userEvent.setup();
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "invalidName" }),
    );
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await user.click(
      await screen.findByRole("button", { name: "More actions for Debounce PTY resize" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use 1 to 80 characters without control characters.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Verify cancelling calls nothing and returns focus.
  it("cancels without calling a command", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const trigger = await screen.findByRole("button", {
      name: "More actions for Debounce PTY resize",
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Rename session…" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(renameSessionMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("ProjectSessionList delete", () => {
  /** Open the confirmation for the only row the block renders. */
  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("button", { name: "More actions for Debounce PTY resize" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete Session" }));
    return screen.findByRole("dialog");
  }

  // Verify the confirmation always appears, names the session, and reads the impact first.
  it("reads the impact and names the session", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const dialog = await openDeleteDialog(user);

    expect(getCloseImpactMock).toHaveBeenCalledExactlyOnceWith({
      kind: "session",
      sessionId: "s1",
    });
    expect(
      within(dialog).getByRole("heading", { name: "Delete session “Debounce PTY resize”?" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Everything in this session is stopped and removed: its tabs, panes and terminal output. This cannot be undone.",
      ),
    ).toBeInTheDocument();
  });

  // Verify a session with no measured blocker renders no fact row at all.
  it("renders no facts for an empty impact", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const dialog = await openDeleteDialog(user);

    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
  });

  // Verify measured blockers are listed exactly as the backend reported them.
  it("lists the measured blockers", async () => {
    const user = userEvent.setup();
    getCloseImpactMock.mockResolvedValue({
      target: { kind: "session", sessionId: "s1" },
      requiresConfirmation: true,
      runningProcessCount: 2,
      runningProcessLabels: ["claude", "pnpm test"],
      unsavedFileCount: 1,
      unsavedFileLabels: ["README.md"],
    });
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const dialog = await openDeleteDialog(user);

    expect(
      within(dialog).getByText("2 running processes will be stopped: claude, pnpm test"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 file with unsaved changes: README.md")).toBeInTheDocument();
  });

  // Verify cancelling never sends the destructive command.
  it("cancels without closing anything", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(closeRuntimeTargetMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Verify confirming sends the confirmed close and closes the dialog without navigating.
  it("deletes the session and stays on the page", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(closeRuntimeTargetMock).toHaveBeenCalledExactlyOnceWith(
      { kind: "session", sessionId: "s1" },
      true,
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("path")).toHaveTextContent(`/projects/${PROJECT_ID}`);
  });

  // Verify a blocker that appeared at commit time re-renders the refreshed facts and asks
  // for one more explicit confirmation.
  it("re-asks with refreshed facts after confirmationRequired", async () => {
    const user = userEvent.setup();
    closeRuntimeTargetMock.mockRejectedValueOnce(
      new IpcCallError("close_runtime_target", {
        code: "confirmationRequired",
        impact: {
          target: { kind: "session", sessionId: "s1" },
          requiresConfirmation: true,
          runningProcessCount: 1,
          runningProcessLabels: ["claude"],
          unsavedFileCount: 0,
          unsavedFileLabels: [],
        },
      }),
    );
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(
      await screen.findByText("1 running process will be stopped: claude"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm again to delete this session.");

    await user.click(screen.getByRole("button", { name: "Delete Session" }));

    expect(closeRuntimeTargetMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Verify a cleanup failure keeps the dialog open with a second attempt.
  it("keeps the dialog open after a cleanup failure", async () => {
    const user = userEvent.setup();
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", {
        code: "contentLifecycleFailed",
        operation: "close",
        targetId: "s1",
      }),
    );
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

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
        targetId: "s1",
      }),
    );
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    const dialog = await openDeleteDialog(user);

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "XWork couldn't check what this session is running.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(getCloseImpactMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Delete Session" })).toBeInTheDocument();
  });

  // Verify a vanished session abandons the flow without opening a confirmation.
  it("opens no confirmation when the session is gone", async () => {
    const user = userEvent.setup();
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", { code: "sessionNotFound", sessionId: "s1" }),
    );
    listSessionsMock.mockResolvedValue([summary()]);
    renderList();

    await user.click(
      await screen.findByRole("button", { name: "More actions for Debounce PTY resize" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete Session" }));

    await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(closeRuntimeTargetMock).not.toHaveBeenCalled();
  });
});
