// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDetailDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import * as cliProfilesIpc from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { recordToolUse, resetRecentTools } from "./recent-tools-store";
import { SessionToolPicker } from "./session-tool-picker";
import { createNonEmptySessionDetail, FIXTURE_SESSION_ID } from "./sessions-test-fixture";

// Replace both boundaries so no case reaches Tauri or a real CLI installation.
vi.mock("@/lib/ipc/sessions", () => ({ selectSessionTool: vi.fn() }));
vi.mock("@/lib/ipc/cli-profiles", () => ({
  checkCliProfile: vi.fn(),
  getCliProfiles: vi.fn(),
  onCliProfilesChanged: vi.fn(),
}));

const selectSessionToolMock = vi.mocked(sessionsIpc.selectSessionTool);
const getCliProfilesMock = vi.mocked(cliProfilesIpc.getCliProfiles);
const checkCliProfileMock = vi.mocked(cliProfilesIpc.checkCliProfile);

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

/** The three built-ins in their exact backend order, plus one custom profile. */
const CODEX = profile();
const CLAUDE = profile({ id: "builtin:claude", name: "Claude", command: "claude", icon: "Cl" });
const TERMINAL = profile({
  id: "builtin:terminal",
  name: "Terminal",
  command: "pwsh.exe",
  icon: ">_",
});
const GEMINI = profile({
  id: "custom-1",
  name: "Gemini CLI",
  kind: "custom",
  command: "gemini",
  arguments: ["--yolo"],
  icon: "Ge",
});

/** Build one catalog snapshot in the documented order. */
function snapshot(profiles: CliProfileDto[] = [CODEX, CLAUDE, TERMINAL, GEMINI]) {
  return {
    revision: "1",
    defaultShellId: "system",
    effectiveDefaultShellId: "pwsh",
    shells: [],
    profiles,
  } satisfies CliProfilesSnapshotDto;
}

/** Intents recorded by every case. */
const onSelected = vi.fn();
const onRefresh = vi.fn();

/** Report the current router path so a navigation can be asserted. */
function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

/** Render the picker at a session route with a Settings destination it can reach. */
function renderPicker() {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${FIXTURE_SESSION_ID}`]}>
      <SessionToolPicker
        sessionId={FIXTURE_SESSION_ID}
        onSelected={onSelected}
        onRefresh={onRefresh}
      />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
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

/** Read the section that carries one block label. */
function block(label: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: label });
  const section = heading.closest("section");
  if (section === null) {
    throw new Error(`The ${label} block should be rendered inside a section.`);
  }
  return section;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRecentTools();
  onSelected.mockReset();
  onRefresh.mockReset();
  getCliProfilesMock.mockResolvedValue(snapshot());
  checkCliProfileMock.mockResolvedValue(CODEX);
  vi.mocked(cliProfilesIpc.onCliProfilesChanged).mockResolvedValue(() => {});
  selectSessionToolMock.mockResolvedValue(createNonEmptySessionDetail());
});

afterEach(() => {
  cleanup();
  resetRecentTools();
});

describe("SessionToolPicker catalog", () => {
  // Verify the first read shows placeholders and no recent block at all.
  it("shows placeholders while the catalog loads", () => {
    const pending = deferred<CliProfilesSnapshotDto>();
    getCliProfilesMock.mockReturnValue(pending.promise);

    renderPicker();

    expect(screen.getByRole("status", { name: "Loading your CLI profiles" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recently used" })).not.toBeInTheDocument();

    pending.resolve(snapshot());
  });

  // Verify the catalog keeps the exact backend order and ends with the add-profile card.
  it("keeps the backend order and ends with the add card", async () => {
    renderPicker();
    await screen.findByText("codex");

    const cards = within(block("All tools")).getAllByRole("button");
    expect(cards.map((card) => card.textContent)).toEqual([
      "CxCodexcodex",
      "ClClaudeclaude",
      ">_Terminalpwsh.exe · default shell",
      "GeGemini CLIgemini --yolo",
      "Add a CLI profileSettings › Terminal & CLI Profiles",
    ]);
  });

  // Verify a failed catalog read explains itself and offers one more attempt.
  it("offers Try again after a failed catalog read", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockRejectedValueOnce(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );

    renderPicker();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "XWork couldn't load your CLI profiles.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("codex")).toBeInTheDocument();
  });

  // Verify the hint states both ways to pick a tool and what picking one does.
  it("states the keyboard hint", async () => {
    renderPicker();

    expect(
      await screen.findByText(
        "Press 1–9 to pick, Enter to start. The tool runs in a new tab at the project root.",
      ),
    ).toBeInTheDocument();
  });

  // Verify the add-profile card reaches the existing Settings page and calls no command.
  it("navigates to the CLI Profiles page", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Add a CLI profile/ }));

    expect(screen.getByTestId("path")).toHaveTextContent("/settings/terminal-profiles");
    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });
});

describe("SessionToolPicker recent block", () => {
  // Verify the block is absent until this run has used at least one tool.
  it("hides the block for a fresh run", async () => {
    renderPicker();
    await screen.findByText("codex");

    expect(screen.queryByRole("heading", { name: "Recently used" })).not.toBeInTheDocument();
  });

  // Verify the block lists the newest pick first and labels when each was used.
  it("lists recent tools newest first with their time labels", async () => {
    const now = Date.now();
    recordToolUse("builtin:claude", now - 120_000);
    recordToolUse("builtin:terminal", now - 30_000);

    renderPicker();
    await screen.findByText("codex");

    const recent = within(block("Recently used")).getAllByRole("button");
    expect(recent.map((card) => card.textContent)).toEqual([
      ">_Terminalpwsh.exe · default shellUsed just now",
      "ClClaudeclaudeUsed 2m ago",
    ]);
  });

  // Verify promoting a tool does not reorder the full catalog, which stays as the backend
  // returned it and may well repeat the same profile.
  it("leaves the All tools order untouched", async () => {
    recordToolUse("custom-1", Date.now());

    renderPicker();
    await screen.findByText("codex");

    const cards = within(block("All tools")).getAllByRole("button");
    expect(cards[0]?.textContent).toContain("Codex");
    expect(cards[3]?.textContent).toContain("Gemini CLI");
    // The same profile appears in both blocks; that duplication is intentional.
    expect(screen.getAllByText("gemini --yolo")).toHaveLength(2);
  });

  // Verify a profile deleted from Settings simply disappears from the recent block.
  it("omits a recent profile the catalog no longer has", async () => {
    recordToolUse("custom-1", Date.now());
    getCliProfilesMock.mockResolvedValue(snapshot([CODEX, CLAUDE, TERMINAL]));

    renderPicker();
    await screen.findByText("codex");

    expect(screen.queryByRole("heading", { name: "Recently used" })).not.toBeInTheDocument();
  });
});

describe("SessionToolPicker selection", () => {
  // Verify a card selects exactly once and hands the returned snapshot to the route.
  it("selects one tool and reports the returned snapshot", async () => {
    const user = userEvent.setup();
    const detail = createNonEmptySessionDetail();
    selectSessionToolMock.mockResolvedValue(detail);
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(selectSessionToolMock).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_SESSION_ID,
      "builtin:codex",
    );
    expect(onSelected).toHaveBeenCalledExactlyOnceWith(detail);
  });

  // Verify a successful selection records the tool for this run, so it appears as recent.
  it("records the selected tool as recent", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    cleanup();
    renderPicker();

    expect(await screen.findByRole("heading", { name: "Recently used" })).toBeInTheDocument();
    expect(within(block("Recently used")).getByText("Used just now")).toBeInTheDocument();
  });

  // Verify two cards pressed almost together send exactly one command.
  it("sends one command for two rapid presses", async () => {
    const user = userEvent.setup();
    const pending = deferred<SessionDetailDto>();
    selectSessionToolMock.mockReturnValue(pending.promise);
    renderPicker();
    await screen.findByText("codex");

    await user.click(screen.getByRole("button", { name: /Codex/ }));
    await user.click(screen.getByRole("button", { name: /Claude/ }));

    expect(selectSessionToolMock).toHaveBeenCalledOnce();

    pending.resolve(createNonEmptySessionDetail());
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledOnce());
  });

  // Verify every card locks and the pressed one says what is happening.
  it("locks every card while one selection runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<SessionDetailDto>();
    selectSessionToolMock.mockReturnValue(pending.promise);
    renderPicker();
    await screen.findByText("codex");

    await user.click(screen.getByRole("button", { name: /Codex/ }));

    expect(await screen.findByText("Starting…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claude/ })).toBeDisabled();

    pending.resolve(createNonEmptySessionDetail());
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledOnce());
  });

  // Verify an unavailable card never selects, whatever the user does to it.
  it("never selects an unavailable card", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshot([profile({ availability: { status: "commandNotFound", checkedAtUnixMs: null } })]),
    );
    renderPicker();

    await user.click(await screen.findByRole("group", { name: "Codex, unavailable" }));

    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });

  // Verify a recheck reads a fresh snapshot and the card becomes selectable again in the
  // same run once the backend reports it as available.
  it("recovers a repaired profile without a reload", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValueOnce(
      snapshot([profile({ availability: { status: "commandNotFound", checkedAtUnixMs: null } })]),
    );
    renderPicker();
    await screen.findByRole("group", { name: "Codex, unavailable" });

    getCliProfilesMock.mockResolvedValue(snapshot([CODEX]));
    await user.click(screen.getByRole("button", { name: /Check again/ }));

    expect(checkCliProfileMock).toHaveBeenCalledExactlyOnceWith("builtin:codex");
    const card = await screen.findByRole("button", { name: /Codex/ });

    await user.click(card);
    expect(selectSessionToolMock).toHaveBeenCalledOnce();
  });
});

describe("SessionToolPicker selection errors", () => {
  /** Reject the next selection with one tagged Sessions error. */
  function rejectSelection(payload: Record<string, unknown>) {
    selectSessionToolMock.mockRejectedValue(
      new IpcCallError("select_session_tool", payload as never),
    );
  }

  // Verify a tool that vanished reloads the catalog and states its own copy.
  it("reloads the catalog after profileNotFound", async () => {
    const user = userEvent.setup();
    rejectSelection({ code: "profileNotFound", profileId: "builtin:codex" });
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That tool no longer exists.");
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
  });

  // Verify a refused profile is marked at once and re-checked behind the marker, so the
  // reason is visible immediately without waiting for a snapshot.
  it("marks and rechecks the profile after profileUnavailable", async () => {
    const user = userEvent.setup();
    // The check is held open, so the assertion observes the temporary marker itself rather
    // than the snapshot that later replaces it.
    const check = deferred<CliProfileDto>();
    checkCliProfileMock.mockReturnValue(check.promise);
    rejectSelection({ code: "profileUnavailable", profileId: "builtin:codex" });
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("group", { name: "Codex, unavailable" })).toBeInTheDocument();
    expect(checkCliProfileMock).toHaveBeenCalledExactlyOnceWith("builtin:codex");

    // The fresh snapshot is the authority, so once it reports the refusal the marker is no
    // longer what keeps the card unavailable.
    getCliProfilesMock.mockResolvedValue(
      snapshot([profile({ availability: { status: "commandNotFound", checkedAtUnixMs: null } })]),
    );
    check.resolve(CODEX);

    expect(await screen.findByText("Command not found: codex")).toBeInTheDocument();
  });

  // Verify a failed lookup states the reason and offers one more attempt.
  it("offers a retry after profileLookupFailed", async () => {
    const user = userEvent.setup();
    rejectSelection({ code: "profileLookupFailed" });
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("XWork couldn't check that tool.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // Verify a session that filled up elsewhere is resolved by the route, with no error shown.
  it.each([
    ["sessionNotEmpty", { code: "sessionNotEmpty" }],
    ["sessionNotFound", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }],
  ])("asks the route to re-read after %s", async (_label, payload) => {
    const user = userEvent.setup();
    rejectSelection(payload);
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Verify a closing session locks the picker instead of letting the user try again.
  it("locks the picker after closeInProgress", async () => {
    const user = userEvent.setup();
    rejectSelection({ code: "closeInProgress", sessionId: FIXTURE_SESSION_ID });
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This session is closing.");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Claude/ })).toBeDisabled());
  });

  // Verify a shutdown stops the flow with no retry.
  it("stops the flow after runtimeShuttingDown", async () => {
    const user = userEvent.setup();
    rejectSelection({ code: "runtimeShuttingDown" });
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("XWork is shutting down.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Verify an unrecognized rejection is reported as an integration problem, not guessed at.
  it("reports an unrecognized rejection", async () => {
    const user = userEvent.setup();
    selectSessionToolMock.mockRejectedValue(new Error("boom"));
    renderPicker();

    await user.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "XWork ran into a problem it cannot recover from. Restart XWork.",
    );
  });
});

describe("SessionToolPicker number keys", () => {
  // Verify a number key selects the card at that position in the rendered order.
  it("selects the card the number points at", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard("2");

    expect(selectSessionToolMock).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_SESSION_ID,
      "builtin:claude",
    );
  });

  // Verify the recent block is counted first, so the numbers follow what is on screen.
  it("counts the recent block first", async () => {
    const user = userEvent.setup();
    recordToolUse("custom-1", Date.now());
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard("1");

    expect(selectSessionToolMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID, "custom-1");
  });

  // Verify a number beyond the visible cards is ignored rather than clamped.
  it("ignores a number beyond the visible cards", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard("9");

    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });

  // Verify the add-profile card is never numbered, so the last number is a real tool.
  it("never numbers the add-profile card", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard("5");

    expect(selectSessionToolMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("path")).toHaveTextContent(`/sessions/${FIXTURE_SESSION_ID}`);
  });

  // Verify a number pointing at an unavailable card only puts the user in front of it.
  it("only focuses an unavailable card", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshot([profile({ availability: { status: "commandNotFound", checkedAtUnixMs: null } })]),
    );
    renderPicker();
    const card = await screen.findByRole("group", { name: "Codex, unavailable" });

    await user.keyboard("1");

    expect(card).toHaveFocus();
    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });

  // Verify a modified key belongs to the application shortcuts, never to this picker.
  it.each([
    ["Control", "{Control>}1{/Control}"],
    ["Alt", "{Alt>}1{/Alt}"],
    ["Meta", "{Meta>}1{/Meta}"],
    ["Shift", "{Shift>}1{/Shift}"],
  ])("ignores a %s-modified number", async (_label, keys) => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard(keys);

    expect(selectSessionToolMock).not.toHaveBeenCalled();
  });

  // Verify a digit typed into a field belongs to that field.
  it("ignores a number typed into a text field", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");
    const field = document.createElement("input");
    document.body.append(field);

    field.focus();
    await user.keyboard("1");

    expect(selectSessionToolMock).not.toHaveBeenCalled();
    expect(field).toHaveValue("1");
    field.remove();
  });

  // Verify a number is ignored while the picker does not own the focus context, which is what
  // keeps an open dialog's keystrokes to itself.
  it("ignores a number while focus is outside the picker", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByText("codex");
    const outside = document.createElement("button");
    document.body.append(outside);

    outside.focus();
    await user.keyboard("1");

    expect(selectSessionToolMock).not.toHaveBeenCalled();
    outside.remove();
  });

  // Verify a number is ignored while a selection is already running.
  it("ignores a number while a selection runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<SessionDetailDto>();
    selectSessionToolMock.mockReturnValue(pending.promise);
    renderPicker();
    await screen.findByText("codex");

    await user.keyboard("1");
    await user.keyboard("2");

    expect(selectSessionToolMock).toHaveBeenCalledOnce();

    pending.resolve(createNonEmptySessionDetail());
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledOnce());
  });
});
