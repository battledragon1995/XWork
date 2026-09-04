// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import {
  describeToolCommand,
  isProfileUnavailable,
  SessionToolCard,
  type SessionToolCardProps,
} from "./session-tool-card";

/** Intents recorded by every case. */
const onSelect = vi.fn();
const onCheckAgain = vi.fn();
const onOpenSettings = vi.fn();

/** Build one profile with the generated shape and an available default. */
function profile(overrides: Partial<CliProfileDto> = {}): CliProfileDto {
  return {
    id: "builtin:codex",
    name: "Codex",
    kind: "builtIn",
    command: "codex",
    arguments: [],
    shellId: null,
    effectiveShellId: "pwsh",
    icon: "Cx",
    color: "#10a37f",
    environment: [],
    availability: { status: "available", checkedAtUnixMs: "1700000000000" },
    ...overrides,
  };
}

/** Render one card with the state a case chooses. */
function renderCard(overrides: Partial<SessionToolCardProps> = {}) {
  const merged: SessionToolCardProps = {
    profile: profile(),
    usedAtLabel: null,
    isUnavailable: false,
    isChecking: false,
    isSelecting: false,
    isLocked: false,
    onSelect,
    onCheckAgain,
    onOpenSettings,
    ...overrides,
  };

  return render(<SessionToolCard {...merged} />);
}

beforeEach(() => {
  onSelect.mockReset();
  onCheckAgain.mockReset();
  onOpenSettings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("describeToolCommand", () => {
  // Verify a bare command is shown on its own.
  it("shows a command with no arguments", () => {
    expect(describeToolCommand(profile())).toEqual({ text: "codex", isReason: false });
  });

  // Verify arguments are joined with single spaces, in their own order.
  it("joins the arguments after the command", () => {
    expect(
      describeToolCommand(profile({ command: "gemini", arguments: ["--yolo", "-v"] })),
    ).toEqual({ text: "gemini --yolo -v", isReason: false });
  });

  // Verify the built-in Terminal names where its shell came from when it has none of its own.
  it("marks the built-in Terminal as using the default shell", () => {
    expect(
      describeToolCommand(
        profile({ id: "builtin:terminal", name: "Terminal", command: "pwsh.exe", shellId: null }),
      ),
    ).toEqual({ text: "pwsh.exe · default shell", isReason: false });
  });

  // Verify a Terminal profile with its own shell adds no suffix, because Settings is not
  // where that choice came from.
  it("adds no suffix when the Terminal profile has its own shell", () => {
    expect(
      describeToolCommand(profile({ id: "builtin:terminal", command: "cmd.exe", shellId: "cmd" })),
    ).toEqual({ text: "cmd.exe", isReason: false });
  });

  // Verify a missing command reports the reason instead of an empty line.
  it("reports an unresolved shell", () => {
    expect(describeToolCommand(profile({ command: null }))).toEqual({
      text: "Shell not resolved",
      isReason: true,
    });
  });

  // Verify each unavailable status replaces the command line with its own reason.
  it.each([
    ["commandNotFound", "Command not found: codex"],
    ["shellNotFound", "Shell not found"],
  ] as const)("reports %s as the reason", (status, expected) => {
    expect(
      describeToolCommand(profile({ availability: { status, checkedAtUnixMs: null } })),
    ).toEqual({ text: expected, isReason: true });
  });
});

describe("isProfileUnavailable", () => {
  // Verify an available profile and an unchecked one are both launchable, because the backend
  // re-checks an unchecked profile the moment it is selected.
  it.each(["available", "unchecked"] as const)("treats %s as launchable", (status) => {
    expect(isProfileUnavailable(profile({ availability: { status, checkedAtUnixMs: null } }))).toBe(
      false,
    );
  });

  // Verify both refused statuses and a missing command are unavailable.
  it.each([
    [
      "commandNotFound",
      profile({ availability: { status: "commandNotFound", checkedAtUnixMs: null } }),
    ],
    [
      "shellNotFound",
      profile({ availability: { status: "shellNotFound", checkedAtUnixMs: null } }),
    ],
    ["a missing command", profile({ command: null })],
  ])("treats %s as unavailable", (_label, candidate) => {
    expect(isProfileUnavailable(candidate as CliProfileDto)).toBe(true);
  });
});

describe("SessionToolCard available", () => {
  // Verify an available card is one button whose whole surface selects the tool.
  it("selects the tool when pressed", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: /Codex/ }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Verify the name and the command are both readable on the card.
  it("shows the name and the command", () => {
    renderCard({ profile: profile({ command: "gemini", arguments: ["--yolo"] }) });

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("gemini --yolo")).toBeInTheDocument();
  });

  // Verify an unchecked profile is still selectable, because the backend checks it on select.
  it("stays selectable while unchecked", async () => {
    const user = userEvent.setup();
    renderCard({
      profile: profile({ availability: { status: "unchecked", checkedAtUnixMs: null } }),
    });

    await user.click(screen.getByRole("button", { name: /Codex/ }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Verify a recent card shows when the tool was last used.
  it("shows its recency label", () => {
    renderCard({ usedAtLabel: "2m ago" });

    expect(screen.getByText("Used 2m ago")).toBeInTheDocument();
  });

  // Verify a running selection replaces the recency label rather than adding to it, so the
  // card's layout does not move while the command is in flight.
  it("replaces the recency label while selecting", () => {
    renderCard({ usedAtLabel: "2m ago", isSelecting: true, isLocked: true });

    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByText("Used 2m ago")).not.toBeInTheDocument();
  });

  // Verify every card locks while any selection runs, so a second press sends nothing.
  it("locks while another card is selecting", async () => {
    const user = userEvent.setup();
    renderCard({ isLocked: true });

    const card = screen.getByRole("button", { name: /Codex/ });
    expect(card).toBeDisabled();

    await user.click(card);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("SessionToolCard unavailable", () => {
  /** Render one card the backend refuses, with the reason a case chooses. */
  function renderUnavailable(overrides: Partial<SessionToolCardProps> = {}) {
    return renderCard({
      profile: profile({
        availability: { status: "commandNotFound", checkedAtUnixMs: null },
      }),
      isUnavailable: true,
      ...overrides,
    });
  }

  // Verify the card says `Unavailable` in words, so colour is never the only signal.
  it("states its unavailability in words", () => {
    renderUnavailable();

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Command not found: codex")).toBeInTheDocument();
  });

  // Verify the other refused status reads its own reason.
  it("states a missing shell", () => {
    renderUnavailable({
      profile: profile({ availability: { status: "shellNotFound", checkedAtUnixMs: null } }),
    });

    expect(screen.getByText("Shell not found")).toBeInTheDocument();
  });

  // Verify the card is not a button at all, so pressing it can never select the tool.
  it("cannot be selected", async () => {
    const user = userEvent.setup();
    renderUnavailable();

    const card = screen.getByRole("group", { name: "Codex, unavailable" });
    await user.click(card);

    expect(onSelect).not.toHaveBeenCalled();
  });

  // Verify the card stays programmatically focusable, which is what a number key needs, while
  // staying out of the Tab order its own two controls belong to.
  it("is focusable but not tabbable", async () => {
    const user = userEvent.setup();
    renderUnavailable();

    const card = screen.getByRole("group", { name: "Codex, unavailable" });
    expect(card).toHaveAttribute("tabindex", "-1");

    card.focus();
    expect(card).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: /Check again/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Open CLI Profiles" })).toHaveFocus();
  });

  // Verify the recheck control raises its own intent.
  it("asks for another check", async () => {
    const user = userEvent.setup();
    renderUnavailable();

    await user.click(screen.getByRole("button", { name: /Check again/ }));

    expect(onCheckAgain).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Verify a running check locks the control and says so in the badge.
  it("locks the recheck control while a check runs", async () => {
    const user = userEvent.setup();
    renderUnavailable({ isChecking: true });

    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();

    const control = screen.getByRole("button", { name: /Check again/ });
    expect(control).toBeDisabled();

    await user.click(control);
    expect(onCheckAgain).not.toHaveBeenCalled();
  });

  // Verify the Settings link raises its own intent and calls no command.
  it("offers a way to the CLI Profiles page", async () => {
    const user = userEvent.setup();
    renderUnavailable();

    await user.click(screen.getByRole("button", { name: "Open CLI Profiles" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCheckAgain).not.toHaveBeenCalled();
  });

  // Verify a profile whose shell could not be resolved is refused for that reason alone.
  it("refuses a profile with no resolvable command", () => {
    renderUnavailable({ profile: profile({ command: null }) });

    expect(screen.getByText("Shell not resolved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Codex/ })).not.toBeInTheDocument();
  });
});
