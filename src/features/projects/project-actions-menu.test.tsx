// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectActionsMenu } from "./project-actions-menu";

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

// Render the menu with intent spies, which is all this component is allowed to raise.
function renderMenu(project: ProjectDto = PROJECT, isBusy = false) {
  const intents = {
    onRename: vi.fn(),
    onTogglePinned: vi.fn(),
    onOpenFolder: vi.fn(),
    onLocateFolder: vi.fn(),
    onRemove: vi.fn(),
  };

  render(
    <TooltipProvider>
      <ProjectActionsMenu project={project} isBusy={isBusy} {...intents} />
    </TooltipProvider>,
  );

  return intents;
}

afterEach(() => {
  cleanup();
});

describe("ProjectActionsMenu items", () => {
  // Verify the five documented items appear exactly once, in the documented order.
  it("lists the five actions in order", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "More actions" }));

    const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "Rename project…",
      "Pin project",
      "Open folder",
      "Locate folder…",
      "Remove Project",
    ]);
  });

  // Verify the pin label states the action, not the current state.
  it.each([
    ["an unpinned project", false, "Pin project"],
    ["a pinned project", true, "Unpin project"],
  ])("labels %s as %s", async (_label, isPinned, expected) => {
    const user = userEvent.setup();
    renderMenu({ ...PROJECT, isPinned });

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("menuitem", { name: expected })).toBeInTheDocument();
  });

  // Verify removal is set apart, which is what keeps it from being picked by accident.
  it("separates Remove Project and marks it destructive", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");

    expect(menu.querySelector('[data-slot="dropdown-menu-separator"]')).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Remove Project" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });

  // Verify an unusable root leaves the opener inert rather than removing it, so the menu keeps
  // the same shape and the reason stays visible on the card.
  it("disables Open folder while the project is unavailable", async () => {
    const user = userEvent.setup();
    const intents = renderMenu({
      ...PROJECT,
      availability: { status: "unavailable", reason: "missing" },
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = await screen.findByRole("menuitem", { name: "Open folder" });

    expect(item).toHaveAttribute("data-disabled");

    await user.click(item);

    expect(intents.onOpenFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Locate folder…" })).not.toHaveAttribute(
      "data-disabled",
    );
  });

  // Verify each item raises its own intent and calls no command itself.
  it.each([
    ["Rename project…", "onRename" as const],
    ["Pin project", "onTogglePinned" as const],
    ["Open folder", "onOpenFolder" as const],
    ["Locate folder…", "onLocateFolder" as const],
    ["Remove Project", "onRemove" as const],
  ])("raises %s as %s", async (name, intent) => {
    const user = userEvent.setup();
    const intents = renderMenu();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name }));

    expect(intents[intent]).toHaveBeenCalledOnce();
  });
});

describe("ProjectActionsMenu keyboard and trigger", () => {
  // Verify the whole menu is reachable with the arrow keys and confirmed with Enter.
  it("moves with the arrow keys and selects with Enter", async () => {
    const user = userEvent.setup();
    const intents = renderMenu();

    screen.getByRole("button", { name: "More actions" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");

    // Opening with Enter already lands on the first item, so one step reaches the second.
    expect(screen.getByRole("menuitem", { name: "Rename project…" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Pin project" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(intents.onTogglePinned).toHaveBeenCalledOnce();
  });

  // Verify Esc closes the menu and puts focus back on the control that opened it.
  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "More actions" });

    await user.click(trigger);
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  // Verify the icon-only trigger explains itself on hover, which §18 requires.
  it("offers a tooltip on the icon-only trigger", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.hover(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("tooltip", { name: "More actions" })).toBeInTheDocument();
  });

  // Verify a card with a running operation cannot open its own menu.
  it("locks the trigger while an operation runs", () => {
    renderMenu(PROJECT, true);

    expect(screen.getByRole("button", { name: "More actions" })).toBeDisabled();
  });
});
