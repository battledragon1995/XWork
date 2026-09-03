// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto, RemoveProjectImpactDto } from "@/bindings/projects/projects";
import { AppProviders } from "@/app/app-providers";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { projectCountSummary, ProjectsRoute } from "./projects-route";
import { resetProjectsStore } from "./projects-store";

/** Navigation spy shared by every case, so card and duplicate targets are observable. */
const navigateMock = vi.fn();

// Replace the backend boundary so no case reaches Tauri, the filesystem or a native picker.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  getRemoveProjectImpact: vi.fn(),
  listProjects: vi.fn(),
  locateProjectFolder: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));

// Keep the real router except for navigation, which is asserted instead of performed.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useNavigate: () => navigateMock };
});

const addProjectMock = vi.mocked(projectsIpc.addProject);
const listProjectsMock = vi.mocked(projectsIpc.listProjects);
const setProjectPinnedMock = vi.mocked(projectsIpc.setProjectPinned);
const renameProjectMock = vi.mocked(projectsIpc.renameProject);
const openProjectFolderMock = vi.mocked(projectsIpc.openProjectFolder);
const locateProjectFolderMock = vi.mocked(projectsIpc.locateProjectFolder);
const getRemoveProjectImpactMock = vi.mocked(projectsIpc.getRemoveProjectImpact);
const removeProjectMock = vi.mocked(projectsIpc.removeProject);

/** One available, unpinned project. */
const XWORK: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** A pinned project, which the backend always returns first. */
const PINNED: ProjectDto = {
  ...XWORK,
  id: "9b1c",
  displayName: "recipe-api",
  rootPath: "D:\\Work\\recipe-api",
  isPinned: true,
};

/** A project whose root became unusable. */
const BROKEN: ProjectDto = {
  ...XWORK,
  id: "7c4d",
  displayName: "invoice-tool",
  rootPath: "D:\\Work\\invoice-tool",
  availability: { status: "unavailable", reason: "missing" },
};

/** Impact with no runtime facts, which is what the Stage 4 runtime guard reports. */
const EMPTY_IMPACT: RemoveProjectImpactDto = {
  projectId: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  sessionCount: 0,
  runningProcessCount: 0,
  unsavedFileCount: 0,
};

// Build one promise a case can settle by hand, which is how pending phases are observed.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Report only the search queries, so the store's own unfiltered calls do not confuse a count.
function searchCalls(): string[] {
  return listProjectsMock.mock.calls
    .map(([search]) => search)
    .filter((search): search is string => search !== undefined);
}

// Render the route inside the shared providers, which is where Tooltip timing comes from.
function renderRoute() {
  return render(
    <AppProviders>
      <ProjectsRoute />
    </AppProviders>,
  );
}

// Read the card headings currently rendered, in DOM order.
function readCardNames(): string[] {
  return screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  listProjectsMock.mockResolvedValue([]);
  addProjectMock.mockResolvedValue({ outcome: "cancelled" });
  setProjectPinnedMock.mockResolvedValue(XWORK);
  renameProjectMock.mockResolvedValue(XWORK);
  openProjectFolderMock.mockResolvedValue(undefined);
  locateProjectFolderMock.mockResolvedValue({ outcome: "cancelled" });
  getRemoveProjectImpactMock.mockResolvedValue(EMPTY_IMPACT);
  removeProjectMock.mockResolvedValue({ projectId: "3f2a" });
});

afterEach(() => {
  cleanup();
});

describe("projectCountSummary", () => {
  // Verify the count line pluralizes and only appends the parts that actually apply.
  it.each([
    ["one project", [XWORK], null, "1 project"],
    ["several plain projects", [XWORK, { ...XWORK, id: "b" }], null, "2 projects"],
    ["no project at all", [], null, "0 projects"],
    ["a pinned project", [PINNED, XWORK], null, "2 projects · 1 pinned"],
    ["an unavailable project", [XWORK, BROKEN], null, "2 projects · 1 unavailable"],
    ["both", [PINNED, XWORK, BROKEN], null, "3 projects · 1 pinned · 1 unavailable"],
    ["an active search", [PINNED, XWORK], 1, "2 projects · 1 pinned · 1 matching"],
  ])("summarizes %s", (_label, projects, matching, expected) => {
    expect(projectCountSummary(projects, matching)).toBe(expected);
  });
});

describe("ProjectsRoute header", () => {
  // Verify the header is present before any data arrives, with the documented controls.
  it("shows the title, search box and Add Project immediately", () => {
    renderRoute();

    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    const search = screen.getByLabelText("Search projects by name or path");
    expect(search).toHaveAttribute("placeholder", "Search by name or path");
    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();
  });

  // Verify the count line reflects the unfiltered snapshot once it exists.
  it("renders the count line from the loaded snapshot", async () => {
    listProjectsMock.mockResolvedValue([PINNED, XWORK, BROKEN]);

    renderRoute();

    expect(await screen.findByText("3 projects · 1 pinned · 1 unavailable")).toBeInTheDocument();
  });
});

describe("ProjectsRoute display states", () => {
  // Verify the first load announces itself without building a fake grid and without a count.
  it("announces the first load and renders no skeleton", () => {
    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    renderRoute();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(within(status).getByText("Loading your projects…")).toHaveClass("sr-only");
    expect(screen.queryByText(/projects$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();

    pending.resolve([]);
  });

  // Verify a refresh keeps the visible grid instead of blanking it.
  it("keeps the grid during a refresh", async () => {
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    window.dispatchEvent(new Event("focus"));

    expect(screen.getByRole("heading", { level: 3, name: "xwork" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    pending.resolve([XWORK, PINNED]);
    expect(
      await screen.findByRole("heading", { level: 3, name: "recipe-api" }),
    ).toBeInTheDocument();
  });

  // Verify a clean install explains what Add Project does and does not do.
  it("shows the no-project empty state", async () => {
    renderRoute();

    expect(
      await screen.findByRole("heading", { level: 2, name: "No projects yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a folder that already exists on this machine. XWork never creates, copies or clones anything.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("0 projects")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add Project" })).toHaveLength(2);
  });

  // Verify the grid follows the exact order the backend returned, pinned project first.
  it("renders the cards in backend order", async () => {
    listProjectsMock.mockResolvedValue([PINNED, XWORK, BROKEN]);

    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "recipe-api" });

    expect(readCardNames()).toEqual(["recipe-api", "xwork", "invoice-tool"]);
  });

  // Verify a retryable load failure offers exactly one more attempt.
  it("offers Try again for a retryable load failure", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );

    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't load your projects.");

    listProjectsMock.mockResolvedValue([XWORK]);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 3, name: "xwork" })).toBeInTheDocument();
    expect(listProjectsMock).toHaveBeenCalledTimes(2);
  });

  // Verify an integration failure offers no retry at all, so no loop can form.
  it("offers no retry for an integration load failure", async () => {
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "unauthorizedWindow" }),
    );

    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "XWork ran into a problem it cannot recover from. Restart XWork.",
    );
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ProjectsRoute search", () => {
  // Verify a burst of keystrokes becomes exactly one sanitized backend query.
  it("sends one sanitized query after the quiet interval", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([PINNED, XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    listProjectsMock.mockResolvedValue([XWORK]);
    await user.type(screen.getByLabelText("Search projects by name or path"), "  xw  ");

    await waitFor(() => expect(searchCalls()).toEqual(["xw"]));
    await waitFor(() => expect(readCardNames()).toEqual(["xwork"]));
    expect(await screen.findByText("2 projects · 1 pinned · 1 matching")).toBeInTheDocument();
  });

  // Verify a query with no result names the query the user can still see in the box.
  it("shows the no-match state with the visible query", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    listProjectsMock.mockResolvedValue([]);
    await user.type(screen.getByLabelText("Search projects by name or path"), "zzz");

    expect(await screen.findByRole("heading", { level: 2, name: "No match" })).toBeInTheDocument();
    expect(screen.getByText('No project name or path contains "zzz".')).toBeInTheDocument();
    // The count line still reports the whole snapshot, so nothing looks like it disappeared.
    expect(screen.getByText("1 project · 0 matching")).toBeInTheDocument();
  });

  // Verify both documented clear affordances empty the query and restore the full grid.
  it.each([
    ["the Clear search control", "button" as const],
    ["the Escape key", "escape" as const],
  ])("clears the query with %s", async (_label, how) => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([PINNED, XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    const input = screen.getByLabelText("Search projects by name or path");
    listProjectsMock.mockResolvedValue([XWORK]);
    await user.type(input, "xw");
    await waitFor(() => expect(readCardNames()).toEqual(["xwork"]));

    if (how === "button") {
      await user.click(screen.getByRole("button", { name: "Clear search" }));
    } else {
      await user.keyboard("{Escape}");
    }

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(readCardNames()).toEqual(["recipe-api", "xwork"]);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  // Verify the icon-only clear control explains itself, which §18 requires.
  it("offers a tooltip on Clear search", async () => {
    const user = userEvent.setup();
    renderRoute();

    await user.type(screen.getByLabelText("Search projects by name or path"), "xw");
    await user.hover(screen.getByRole("button", { name: "Clear search" }));

    expect(await screen.findByRole("tooltip", { name: "Clear search" })).toBeInTheDocument();
  });
});

describe("ProjectsRoute Add Project", () => {
  // Verify the running picker is visible and cannot be started twice from this page.
  it("locks the button and renames it while the picker is open", async () => {
    const user = userEvent.setup();
    const picker = deferred<{ outcome: "cancelled" }>();
    addProjectMock.mockReturnValue(picker.promise);
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    const button = screen.getByRole("button", { name: "Add Project" });
    await user.click(button);

    const busy = await screen.findByRole("button", { name: "Selecting folder…" });
    expect(busy).toBeDisabled();

    picker.resolve({ outcome: "cancelled" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Add Project" })).toBeEnabled());
    expect(addProjectMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Verify a duplicate folder offers to open the project that already owns it.
  it("offers Open project for a duplicate folder", async () => {
    const user = userEvent.setup();
    addProjectMock.mockRejectedValue(
      new IpcCallError("add_project", { code: "projectAlreadyExists", project_id: "9b1c" }),
    );
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That folder is already a project in XWork.");

    await user.click(within(alert).getByRole("button", { name: "Open project" }));

    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/projects/9b1c");
  });

  // Verify the user can close the message without starting another attempt.
  it("dismisses the Add Project failure", async () => {
    const user = userEvent.setup();
    addProjectMock.mockRejectedValue(new IpcCallError("add_project", { code: "clockFailed" }));
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "Add Project" }));
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(addProjectMock).toHaveBeenCalledOnce();
  });
});

describe("ProjectsRoute card actions", () => {
  // Verify the card's primary action only navigates: no command belongs to opening a project.
  it("navigates from Open without calling a command", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/projects/3f2a");
    expect(openProjectFolderMock).not.toHaveBeenCalled();
  });

  // Verify pinning reorders the grid from the refreshed backend order while focus stays on
  // the same card's menu trigger, which only works because cards are keyed by project id.
  it("keeps focus on the card after a pin reorder", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([PINNED, XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });
    expect(readCardNames()).toEqual(["recipe-api", "xwork"]);

    const trigger = within(
      screen.getByRole("heading", { level: 3, name: "xwork" }).closest("article") as HTMLElement,
    ).getByRole("button", { name: "More actions" });

    await user.click(trigger);
    listProjectsMock.mockResolvedValue([{ ...XWORK, isPinned: true }, PINNED]);
    await user.click(await screen.findByRole("menuitem", { name: "Pin project" }));

    expect(setProjectPinnedMock).toHaveBeenCalledExactlyOnceWith("3f2a", true);
    await waitFor(() => expect(readCardNames()).toEqual(["xwork", "recipe-api"]));
    expect(trigger).toHaveFocus();
  });

  // Verify a failed action explains itself on the page and can be repeated from there.
  it("shows a retryable action failure with its recovery", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    openProjectFolderMock.mockRejectedValue(
      new IpcCallError("open_project_folder", { code: "openFolderFailed" }),
    );
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open folder" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't open the folder for xwork. Try again.");

    openProjectFolderMock.mockResolvedValue(undefined);
    await user.click(within(alert).getByRole("button", { name: "Open folder" }));

    expect(openProjectFolderMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  // Verify an unusable root offers relocation from the page line, not another blind attempt.
  it("offers Locate folder… when the root became unusable", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    openProjectFolderMock.mockRejectedValue(
      new IpcCallError("open_project_folder", { code: "projectUnavailable", reason: "missing" }),
    );
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open folder" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork can't open that folder any more.");

    await user.click(within(alert).getByRole("button", { name: "Locate folder…" }));

    expect(locateProjectFolderMock).toHaveBeenCalledExactlyOnceWith("3f2a");
  });

  // Verify the card's own relocation button reaches the same command.
  it("relocates from an unavailable card", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([BROKEN]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "invoice-tool" });

    await user.click(screen.getByRole("button", { name: "Locate folder…" }));

    expect(locateProjectFolderMock).toHaveBeenCalledExactlyOnceWith("7c4d");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ProjectsRoute dialogs", () => {
  // Verify the rename dialog opens on the right project and hands focus back to its card.
  it("opens rename and returns focus to the card on cancel", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });
    const trigger = screen.getByRole("button", { name: "More actions" });

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Rename project…" }));

    expect(await screen.findByRole("heading", { name: "Rename project" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("xwork");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(renameProjectMock).not.toHaveBeenCalled();
  });

  // Verify a successful rename closes the dialog, refreshes the grid and restores focus.
  it("renames and returns focus to the card", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });
    const trigger = screen.getByRole("button", { name: "More actions" });

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Rename project…" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "XWork");
    listProjectsMock.mockResolvedValue([{ ...XWORK, displayName: "XWork" }]);
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(renameProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", "XWork");
    expect(await screen.findByRole("heading", { level: 3, name: "XWork" })).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  // Verify removal reads the impact first, confirms explicitly, and then moves focus to the
  // search box because the card that opened the dialog no longer exists.
  it("removes a project and moves focus to search", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove Project" }));

    const dialog = await screen.findByRole("dialog");
    expect(getRemoveProjectImpactMock).toHaveBeenCalledExactlyOnceWith("3f2a");

    listProjectsMock.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "Remove Project" }));

    expect(removeProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", true);
    expect(
      await screen.findByRole("heading", { level: 2, name: "No projects yet" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Search projects by name or path")).toHaveFocus(),
    );
  });

  // Verify cancelling the confirmation removes nothing and returns focus to the card.
  it("returns focus to the card when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });
    const trigger = screen.getByRole("button", { name: "More actions" });

    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Remove Project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(removeProjectMock).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  // Verify a failed impact read never opens the confirmation.
  it("opens no confirmation when the impact read fails", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    getRemoveProjectImpactMock.mockRejectedValue(
      new IpcCallError("get_remove_project_impact", { code: "runtimeInspectionFailed" }),
    );
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove Project" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't check what is still running for xwork.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("ProjectsRoute keyboard order", () => {
  // Verify the documented Tab order through the content area, including the error line and
  // the two controls inside each card.
  it("follows the documented tab order", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);
    addProjectMock.mockRejectedValue(new IpcCallError("add_project", { code: "clockFailed" }));
    renderRoute();
    await screen.findByRole("heading", { level: 3, name: "xwork" });

    const input = screen.getByLabelText("Search projects by name or path");
    await user.type(input, "xw");
    await user.click(screen.getByRole("button", { name: "Add Project" }));
    await screen.findByRole("alert");

    input.focus();
    const expected = ["Clear search", "Add Project", "Dismiss", "Open", "More actions"];

    for (const name of expected) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
    }
  });
});
