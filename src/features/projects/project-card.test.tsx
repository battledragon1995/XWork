// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto, ProjectUnavailableReasonDto } from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectCard } from "./project-card";

/** One available, unpinned project used wherever the exact field values do not matter. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

// Render one card with intent spies; the card itself runs no command.
function renderCard(overrides: Partial<ProjectDto> = {}, isBusy = false) {
  const intents = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onTogglePinned: vi.fn(),
    onOpenFolder: vi.fn(),
    onLocateFolder: vi.fn(),
    onRemove: vi.fn(),
  };

  render(
    <TooltipProvider>
      <ProjectCard
        project={{ ...PROJECT, ...overrides }}
        isBusy={isBusy}
        registerTrigger={vi.fn()}
        {...intents}
      />
    </TooltipProvider>,
  );

  return intents;
}

afterEach(() => {
  cleanup();
});

describe("ProjectCard content", () => {
  // Verify the card shows the name and the full path, with the path also available as a
  // tooltip because the visible text is truncated.
  it("shows the name and the full path", () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "xwork" })).toBeInTheDocument();

    const path = screen.getByText("D:\\Self\\XWork");
    expect(path).toHaveAttribute("title", "D:\\Self\\XWork");
    expect(path).toHaveClass("truncate");
  });

  // Verify the name is truncated rather than allowed to widen the card.
  it("truncates a long name instead of stretching the card", () => {
    renderCard({ displayName: "a".repeat(200) });

    expect(screen.getByRole("heading", { name: "a".repeat(200) })).toHaveClass("truncate");
  });

  // Verify the pin glyph carries hidden text, since a non-interactive icon cannot host a
  // tooltip a keyboard user could reach.
  it("announces a pinned project with hidden text", () => {
    renderCard({ isPinned: true });

    expect(screen.getByText("Pinned")).toHaveClass("sr-only");
  });

  // Verify an unpinned card says nothing about pinning at all.
  it("says nothing about pinning when the project is not pinned", () => {
    renderCard();

    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  // Verify none of the data owned by later capabilities leaks into this slice.
  it("renders no branch, Git status or session line", () => {
    renderCard();

    for (const deferred of [
      "main",
      "clean",
      "Not a Git repository",
      "No sessions",
      "1 session",
      "changed",
    ]) {
      expect(screen.queryByText(deferred)).not.toBeInTheDocument();
    }
  });
});

describe("ProjectCard availability", () => {
  // Verify an available card offers Open and shows no status badge at this stage.
  it("offers Open with no status badge while available", async () => {
    const user = userEvent.setup();
    const intents = renderCard();

    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(intents.onOpen).toHaveBeenCalledOnce();
    expect(intents.onLocateFolder).not.toHaveBeenCalled();
  });

  // Verify an unusable root swaps the primary action, adds the badge and explains itself.
  it.each<[ProjectUnavailableReasonDto, string]>([
    ["missing", "Folder not found."],
    ["notDirectory", "That path is no longer a folder."],
    ["accessDenied", "XWork can't read that folder."],
    ["io", "XWork couldn't check that folder."],
  ])("explains the %s reason and offers relocation", async (reason, message) => {
    const user = userEvent.setup();
    const intents = renderCard({ availability: { status: "unavailable", reason } });

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Locate folder…" }));

    expect(intents.onLocateFolder).toHaveBeenCalledOnce();
    expect(intents.onOpen).not.toHaveBeenCalled();
  });

  // Verify the badge and the reason line use the shared warning tokens, not literal colors.
  it("colors the unavailable badge from the shared tokens", () => {
    renderCard({ availability: { status: "unavailable", reason: "missing" } });

    expect(screen.getByText("Unavailable")).toHaveClass("bg-warn-surface", "text-warn-ink");
    expect(screen.getByText("Folder not found.")).toHaveClass("text-warn-ink");
  });
});

describe("ProjectCard pending state", () => {
  // Verify exactly the card with a running operation is locked, both action and menu.
  it.each([
    ["an available project", { availability: { status: "available" } as const }, "Open"],
    [
      "an unavailable project",
      { availability: { status: "unavailable", reason: "missing" } as const },
      "Locate folder…",
    ],
  ])("locks both controls of %s while busy", (_label, overrides, actionName) => {
    renderCard(overrides, true);

    expect(screen.getByRole("button", { name: actionName })).toBeDisabled();
    expect(screen.getByRole("button", { name: "More actions" })).toBeDisabled();
  });
});
