import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto, ProjectGitSummaryDto } from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  formatAddedAt,
  formatOpenedAt,
  ProjectOverviewHeader,
  ProjectUnavailableBanner,
} from "./project-overview-header";

/** One available project with stable dates for header assertions. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: true,
  addedAtMs: new Date(2026, 8, 1, 12).getTime(),
  lastOpenedAtMs: new Date(2026, 8, 3, 12).getTime(),
  availability: { status: "available" },
};

/** Default worktree summary whose head and counts individual tests replace. */
const SUMMARY: ProjectGitSummaryDto = {
  projectId: "3f2a",
  repositoryKind: "worktree",
  head: { kind: "branch", name: "main" },
  changedCount: 2,
  untrackedCount: 1,
};

/** Clipboard double used for success, failure, and retry paths. */
const writeText = vi.fn<(value: string) => Promise<void>>();

/** Render a complete header with inert action intents. */
function renderHeader(
  project: ProjectDto = PROJECT,
  summary: ProjectGitSummaryDto | null = SUMMARY,
  gitPhase: "idle" | "loading" | "ready" | "failed" = "ready",
) {
  return render(
    <TooltipProvider>
      <ProjectOverviewHeader
        project={project}
        gitSummary={summary}
        gitPhase={gitPhase}
        isActionsBusy={false}
        onOpenRename={vi.fn()}
        onTogglePinned={vi.fn()}
        onOpenFolder={vi.fn()}
        onLocateFolder={vi.fn()}
        onRequestRemove={vi.fn()}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 8, 3, 12).getTime());
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("timestamp formatting", () => {
  // Verify added dates omit the current year and include a different one.
  it("formats added dates with the documented year rule", () => {
    const now = new Date(2026, 8, 3, 12).getTime();

    expect(formatAddedAt(new Date(2026, 8, 1, 12).getTime(), now)).toBe("added 1 Sep");
    expect(formatAddedAt(new Date(2025, 8, 1, 12).getTime(), now)).toBe("added 1 Sep 2025");
  });

  // Verify every relative boundary and the two absolute opened-date forms.
  it("formats opened timestamps across every boundary", () => {
    const now = new Date(2026, 8, 3, 12).getTime();

    expect(formatOpenedAt(now - 59_000, now)).toBe("opened just now");
    expect(formatOpenedAt(now - 5 * 60_000, now)).toBe("opened 5m ago");
    expect(formatOpenedAt(now - 2 * 3_600_000, now)).toBe("opened 2h ago");
    expect(formatOpenedAt(new Date(2026, 8, 2, 10).getTime(), now)).toBe("opened yesterday");
    expect(formatOpenedAt(new Date(2026, 7, 1, 12).getTime(), now)).toBe("opened 1 Aug");
    expect(formatOpenedAt(new Date(2025, 7, 1, 12).getTime(), now)).toBe("opened 1 Aug 2025");
  });
});

describe("ProjectOverviewHeader", () => {
  // Verify core metadata, pin semantics, full path title, and changed/untracked summary.
  it("renders project metadata and the worktree summary", () => {
    renderHeader();

    expect(screen.getByRole("heading", { level: 1, name: "xwork" })).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toHaveClass("sr-only");
    expect(screen.getByTitle("D:\\Self\\XWork")).toHaveTextContent("D:\\Self\\XWork");
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2 changed · 1 untracked")).toBeInTheDocument();
    expect(screen.getByText("opened just now")).toBeInTheDocument();
  });

  // Verify every repository/head copy branch and omission of a zero untracked count.
  it.each([
    [
      "not repository",
      { ...SUMMARY, repositoryKind: "notRepository", head: null },
      "Not a Git repository",
    ],
    ["bare without head", { ...SUMMARY, repositoryKind: "bare", head: null }, "Bare repository"],
    [
      "bare with head",
      { ...SUMMARY, repositoryKind: "bare", head: { kind: "branch", name: "main" } },
      "Bare repository",
    ],
    ["unborn", { ...SUMMARY, head: { kind: "unborn", name: "trunk" } }, "no commits yet"],
    ["detached", { ...SUMMARY, head: { kind: "detached", shortOid: "a1b2c3d" } }, "(a1b2c3d)"],
    ["clean", { ...SUMMARY, changedCount: 0, untrackedCount: 0 }, "clean"],
    ["changed only", { ...SUMMARY, changedCount: 2, untrackedCount: 0 }, "2 changed"],
  ] as const)("renders the %s Git branch", (_label, summary, expected) => {
    renderHeader(PROJECT, summary as ProjectGitSummaryDto);

    expect(screen.getByText(expected)).toBeInTheDocument();
    if (summary.untrackedCount === 0) {
      expect(screen.queryByText(/0 untracked/)).not.toBeInTheDocument();
    }
  });

  // Verify copy success is announced, reverts after two seconds, and remains retryable.
  it("copies the full path and reverts its temporary label", async () => {
    vi.useFakeTimers();
    renderHeader();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith("D:\\Self\\XWork");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText("Path copied")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
  });

  // Verify clipboard refusal uses the live region and a later click can succeed.
  it("announces a clipboard failure and allows retry", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderHeader();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    });
    expect(screen.getByText("XWork couldn't copy the path.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Path copied")).toBeInTheDocument();
  });

  // Verify root-dependent controls lock while New Session remains focusable and explanatory.
  it("locks unavailable root actions without disabling New Session focus", async () => {
    const user = userEvent.setup();
    renderHeader({ ...PROJECT, availability: { status: "unavailable", reason: "missing" } }, null);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeDisabled();
    const newSession = screen.getByRole("button", { name: "New Session" });
    expect(newSession).toHaveAttribute("aria-disabled", "true");
    expect(newSession).not.toBeDisabled();
    await user.hover(newSession);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The project folder is unavailable.",
    );
  });

  // Verify the header's four focusable controls follow the documented order.
  it("follows the header-local tab order", async () => {
    const user = userEvent.setup();
    renderHeader();

    for (const name of ["Copy path", "Open folder", "New Session", "More actions"]) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
    }
  });
});

describe("ProjectUnavailableBanner", () => {
  // Verify all four reason messages and both direct action intents.
  it.each([
    ["missing", "Folder not found."],
    ["notDirectory", "That path is no longer a folder."],
    ["accessDenied", "XWork can't read that folder."],
    ["io", "XWork couldn't check that folder."],
  ] as const)("renders and forwards the %s recovery flow", async (reason, message) => {
    const user = userEvent.setup();
    const onLocateFolder = vi.fn();
    const onRequestRemove = vi.fn();
    render(
      <ProjectUnavailableBanner
        project={{ ...PROJECT, availability: { status: "unavailable", reason } }}
        isActionsBusy={false}
        onLocateFolder={onLocateFolder}
        onRequestRemove={onRequestRemove}
      />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(
      screen.getByText("Sessions cannot start until the path is valid again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Locate folder…" }));
    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    expect(onLocateFolder).toHaveBeenCalledOnce();
    expect(onRequestRemove).toHaveBeenCalledOnce();
  });
});
