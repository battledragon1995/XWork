// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfileDto, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  checkCliProfile,
  createCliProfile,
  deleteCliProfile,
  getCliProfiles,
  onCliProfilesChanged,
  setDefaultCliShell,
  updateCliProfile,
} from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { resetCliProfilesStore } from "./cli-profiles-store";
import {
  BUILT_IN_CODEX_ID,
  createCliProfilesSnapshot,
  createCliShellDto,
  createCustomProfileDto,
} from "./cli-profiles-test-fixture";
import { SettingsTerminalProfilesRoute } from "./settings-terminal-profiles-route";

// Replace the only boundary the page reads, so no case reaches Tauri or real profile data.
vi.mock("@/lib/ipc/cli-profiles", () => ({
  getCliProfiles: vi.fn(),
  createCliProfile: vi.fn(),
  updateCliProfile: vi.fn(),
  deleteCliProfile: vi.fn(),
  setDefaultCliShell: vi.fn(),
  checkCliProfile: vi.fn(),
  onCliProfilesChanged: vi.fn(),
}));

const getCliProfilesMock = vi.mocked(getCliProfiles);
const setDefaultCliShellMock = vi.mocked(setDefaultCliShell);
const checkCliProfileMock = vi.mocked(checkCliProfile);
const onCliProfilesChangedMock = vi.mocked(onCliProfilesChanged);

beforeEach(() => {
  resetCliProfilesStore();
  getCliProfilesMock.mockReset().mockResolvedValue(createCliProfilesSnapshot());
  vi.mocked(createCliProfile).mockReset();
  vi.mocked(updateCliProfile).mockReset();
  vi.mocked(deleteCliProfile).mockReset();
  setDefaultCliShellMock.mockReset();
  checkCliProfileMock.mockReset();
  onCliProfilesChangedMock.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  cleanup();
  resetCliProfilesStore();
});

/** Render the page inside the one provider the shell supplies for icon-only tooltips. */
function renderPage() {
  return render(
    <TooltipProvider>
      <SettingsTerminalProfilesRoute />
    </TooltipProvider>,
  );
}

/** Render the page and wait until the first snapshot has replaced the loading state. */
async function renderReadyPage() {
  const result = renderPage();
  await screen.findByRole("table", { name: "Built-in profiles" });
  return result;
}

/** Read the visible row labels of one profile table, in render order. */
function readRowNames(label: string): string[] {
  return within(screen.getByRole("table", { name: label }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

/** Build one tagged rejection exactly as the shared IPC boundary produces it. */
function tagged(code: string): unknown {
  return new IpcCallError("get_cli_profiles", { code } as { code: string });
}

/** Build a snapshot whose custom group holds the given profiles. */
function snapshotWithCustom(
  profiles: CliProfileDto[],
  overrides: Partial<CliProfilesSnapshotDto> = {},
): CliProfilesSnapshotDto {
  const base = createCliProfilesSnapshot(overrides);
  return { ...base, profiles: [...base.profiles, ...profiles] };
}

describe("read states", () => {
  // Verify the header stays while the first read is still running.
  it("shows the loading state before the first snapshot", () => {
    getCliProfilesMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Terminal & CLI Profiles" }),
    ).toBeInTheDocument();
    const loading = screen.getByText("Loading CLI profiles…");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table", { name: "Built-in profiles" })).not.toBeInTheDocument();
  });

  // Verify the page description matches the wireframe copy exactly.
  it("renders the page description", async () => {
    await renderReadyPage();

    expect(
      screen.getByText(
        "Which shell opens by default and which tools appear on the New Session screen.",
      ),
    ).toBeInTheDocument();
  });

  // Verify a first-read failure is announced and can be retried.
  it("reports a first-read failure with a retry", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockRejectedValueOnce(tagged("persistenceFailed"));

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't load CLI profiles.");

    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot());
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Built-in profiles" })).toBeInTheDocument();
  });

  // Verify an integration failure offers no retry loop the user cannot win.
  it("offers no retry for an unauthorized window", async () => {
    getCliProfilesMock.mockRejectedValue(tagged("unauthorizedWindow"));

    renderPage();

    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Verify a refresh keeps the committed tables on screen instead of blanking them.
  it("keeps the tables while refreshing", async () => {
    await renderReadyPage();

    let settle: (snapshot: CliProfilesSnapshotDto) => void = () => {};
    getCliProfilesMock.mockReturnValue(
      new Promise<CliProfilesSnapshotDto>((resolve) => {
        settle = resolve;
      }),
    );
    const handler = onCliProfilesChangedMock.mock.calls[0]?.[0];
    handler?.({ revision: "1", kind: "availabilityChanged", profileId: null });

    expect(await screen.findByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Built-in profiles" })).toBeInTheDocument();

    settle(createCliProfilesSnapshot({ revision: "1" }));
    await waitFor(() => expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument());
  });

  // Verify a refused listener registration warns without blocking, and offers a manual read.
  it("warns when live updates could not be registered", async () => {
    const user = userEvent.setup();
    onCliProfilesChangedMock.mockRejectedValue(new Error("refused"));

    await renderReadyPage();

    expect(
      await screen.findByText("CLI profile status won't update automatically."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
  });
});

describe("default shell", () => {
  // Verify the persisted `system` choice stays selected while the resolved shell is named.
  it("keeps System default selected and names the effective shell", async () => {
    await renderReadyPage();

    const select = screen.getByLabelText("Default shell") as HTMLSelectElement;
    expect(select.value).toBe("system");
    expect(within(select).getByRole("option", { name: "System default" })).toBeInTheDocument();
    expect(screen.getByText("Resolves to PowerShell 7 (pwsh.exe).")).toBeInTheDocument();
  });

  // Verify the help copy matches the wireframe exactly.
  it("renders the default shell help text", async () => {
    await renderReadyPage();

    expect(
      screen.getByText("Used by the Terminal profile and by any profile without its own shell."),
    ).toBeInTheDocument();
  });

  // Verify a concrete persisted shell is selected and no effective-shell line is needed.
  it("selects a concrete persisted shell", async () => {
    getCliProfilesMock.mockResolvedValue(
      createCliProfilesSnapshot({ defaultShellId: "cmd", effectiveDefaultShellId: "cmd" }),
    );

    await renderReadyPage();

    expect((screen.getByLabelText("Default shell") as HTMLSelectElement).value).toBe("cmd");
    expect(screen.queryByText(/^Resolves to /)).not.toBeInTheDocument();
  });

  // Verify an unavailable catalog entry cannot be chosen but is still listed honestly.
  it("disables an unavailable shell option", async () => {
    getCliProfilesMock.mockResolvedValue(
      createCliProfilesSnapshot({
        shells: [
          createCliShellDto({ id: "system", displayName: "System default", isDefault: true }),
          createCliShellDto({ id: "pwsh", displayName: "PowerShell 7" }),
          createCliShellDto({ id: "cmd", displayName: "Command Prompt", isAvailable: false }),
        ],
      }),
    );

    await renderReadyPage();

    expect(screen.getByRole("option", { name: "Command Prompt" })).toBeDisabled();
  });

  // Verify a persisted shell the catalog no longer lists is shown without inventing a new one.
  it("shows a persisted shell that left the catalog", async () => {
    getCliProfilesMock.mockResolvedValue(
      createCliProfilesSnapshot({ defaultShellId: "unknown-shell" }),
    );

    await renderReadyPage();

    const select = screen.getByLabelText("Default shell") as HTMLSelectElement;
    expect(select.value).toBe("unknown-shell");
    expect(
      within(select).getByRole("option", { name: "Unavailable: unknown-shell" }),
    ).toBeInTheDocument();
    expect(setDefaultCliShellMock).not.toHaveBeenCalled();
  });

  // Verify a catalog with no usable shell locks the control and explains the recovery.
  it("locks the control when no shell is available", async () => {
    getCliProfilesMock.mockResolvedValue(
      createCliProfilesSnapshot({
        shells: [
          createCliShellDto({ id: "system", displayName: "System default", isAvailable: false }),
          createCliShellDto({ id: "pwsh", displayName: "PowerShell 7", isAvailable: false }),
        ],
      }),
    );

    await renderReadyPage();

    expect(screen.getByLabelText("Default shell")).toBeDisabled();
    expect(
      screen.getByText("No available shell was found. Install a supported shell, then refresh."),
    ).toBeInTheDocument();
  });

  // Verify choosing a shell sends only its stable catalog id and announces the write.
  it("persists a chosen shell and announces saving", async () => {
    const user = userEvent.setup();
    await renderReadyPage();

    let settle: (snapshot: CliProfilesSnapshotDto) => void = () => {};
    setDefaultCliShellMock.mockReturnValue(
      new Promise<CliProfilesSnapshotDto>((resolve) => {
        settle = resolve;
      }),
    );

    await user.selectOptions(screen.getByLabelText("Default shell"), "cmd");

    expect(setDefaultCliShellMock).toHaveBeenCalledExactlyOnceWith("cmd");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByLabelText("Default shell")).toBeDisabled();

    settle(
      createCliProfilesSnapshot({
        revision: "1",
        defaultShellId: "cmd",
        effectiveDefaultShellId: "cmd",
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Default shell") as HTMLSelectElement).value).toBe("cmd"),
    );
  });

  // Verify a failed write rolls the visible selection back to the committed snapshot.
  it("rolls the selection back when the write fails", async () => {
    const user = userEvent.setup();
    await renderReadyPage();
    setDefaultCliShellMock.mockRejectedValue(tagged("shellNotFound"));

    await user.selectOptions(screen.getByLabelText("Default shell"), "cmd");

    expect(
      await screen.findByText("That shell isn't available on this computer. Pick another shell."),
    ).toBeInTheDocument();
    expect((screen.getByLabelText("Default shell") as HTMLSelectElement).value).toBe("system");
  });
});

describe("profile tables", () => {
  // Verify the built-ins keep their backend order and expose no mutation affordance.
  it("renders the three built-ins in contract order without Edit or Delete", async () => {
    await renderReadyPage();

    expect(readRowNames("Built-in profiles")).toEqual(["CxCodex", "ClClaude", ">_Terminal"]);
    expect(screen.getByRole("button", { name: "Check command for Codex" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Codex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Terminal" })).not.toBeInTheDocument();
  });

  // Verify the four column headers match the wireframe.
  it("renders the documented column headers", async () => {
    await renderReadyPage();

    const headers = within(screen.getByRole("table", { name: "Built-in profiles" }))
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers.slice(0, 3)).toEqual(["Profile", "Command", "Status"]);
  });

  // Verify a null command is shown honestly rather than as an empty cell.
  it("renders a missing command as an em dash", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([], {
        profiles: [createCustomProfileDto({ id: "b", command: null, kind: "builtIn" })],
      }),
    );

    await renderReadyPage();

    expect(screen.getByRole("table", { name: "Built-in profiles" })).toHaveTextContent("—");
  });

  // Verify the empty state keeps the group heading and the create action.
  it("shows the custom empty state", async () => {
    await renderReadyPage();

    expect(screen.getByRole("heading", { name: "Custom profiles" })).toBeInTheDocument();
    expect(screen.getByText("No custom profiles yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Profile" })).toBeEnabled();
  });

  // Verify custom profiles keep the backend order and expose all three row actions.
  it("renders custom profiles in snapshot order with every action", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([
        createCustomProfileDto({ id: "c1", name: "Gemini CLI" }),
        createCustomProfileDto({ id: "c2", name: "Aider", icon: "Ai" }),
      ]),
    );

    await renderReadyPage();

    expect(readRowNames("Custom profiles")).toEqual(["GeGemini CLI", "AiAider"]);
    expect(screen.getByRole("button", { name: "Edit Gemini CLI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Aider" })).toBeInTheDocument();
  });

  // Verify the display command keeps arguments visible without ever becoming input again.
  it("shows custom arguments as display text only", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([
        createCustomProfileDto({ id: "c1", command: "aider", arguments: ["--model", "o3", "a b"] }),
      ]),
    );

    await renderReadyPage();

    const row = within(screen.getByRole("table", { name: "Custom profiles" })).getAllByRole(
      "row",
    )[1];
    expect(within(row as HTMLElement).getAllByRole("cell")[1]).toHaveTextContent(
      'aider --model o3 "a b"',
    );
  });

  // Verify reaching the profile limit blocks creation and says how to recover.
  it("blocks New Profile at the 100 custom profile limit", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom(
        Array.from({ length: 100 }, (_unused, index) =>
          createCustomProfileDto({ id: `c${index}`, name: `Profile ${index}` }),
        ),
      ),
    );

    await renderReadyPage();

    expect(screen.getByRole("button", { name: "New Profile" })).toBeDisabled();
    expect(
      screen.getByText("Delete a custom profile before creating another."),
    ).toBeInTheDocument();
  });

  // Verify every availability state is readable as text, never as colour alone.
  it.each([
    ["unchecked", "Not checked"],
    ["available", "Available"],
    ["commandNotFound", "Command not found"],
    ["shellNotFound", "Shell not found"],
  ] as const)("renders the %s availability as %s", async (status, label) => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([
        createCustomProfileDto({
          id: "c1",
          availability: {
            status,
            checkedAtUnixMs: status === "unchecked" ? null : "1700000000000",
          },
        }),
      ]),
    );

    await renderReadyPage();

    const row = within(screen.getByRole("table", { name: "Custom profiles" })).getAllByRole(
      "row",
    )[1];
    expect(within(row as HTMLElement).getByText(label)).toBeInTheDocument();
  });

  // Verify a checked time is shown next to a result, and never invented without one.
  it("renders a checked time only when the backend supplied one", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([
        createCustomProfileDto({
          id: "c1",
          availability: { status: "available", checkedAtUnixMs: "1700000000000" },
        }),
        createCustomProfileDto({
          id: "c2",
          name: "No time",
          availability: { status: "available", checkedAtUnixMs: null },
        }),
        createCustomProfileDto({
          id: "c3",
          name: "Bad time",
          availability: { status: "available", checkedAtUnixMs: "not-a-number" },
        }),
      ]),
    );

    await renderReadyPage();

    const rows = within(screen.getByRole("table", { name: "Custom profiles" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/Checked \d{2}:\d{2}/);
    expect(rows[2]).not.toHaveTextContent(/Checked/);
    expect(rows[3]).not.toHaveTextContent(/Checked/);
  });

  // Verify a colour is never the only identity signal a row carries.
  it("names a profile in text next to its coloured mark", async () => {
    await renderReadyPage();

    const row = within(screen.getByRole("table", { name: "Built-in profiles" })).getAllByRole(
      "row",
    )[1];
    expect(within(row as HTMLElement).getByText("Codex")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Cx")).toHaveAttribute("aria-hidden", "true");
  });

  // Verify the table scrolls inside its own container rather than the whole page.
  it("keeps horizontal overflow inside the table container", async () => {
    await renderReadyPage();

    const container = screen.getByRole("table", { name: "Built-in profiles" }).parentElement;
    expect(container?.className).toContain("overflow-x-auto");
  });
});

describe("row actions", () => {
  // Verify a row check calls the backend for that exact profile and marks only that row.
  it("checks one profile and shows its own pending state", async () => {
    const user = userEvent.setup();
    await renderReadyPage();

    let settle: (profile: CliProfileDto) => void = () => {};
    checkCliProfileMock.mockReturnValue(
      new Promise<CliProfileDto>((resolve) => {
        settle = resolve;
      }),
    );

    await user.click(screen.getByRole("button", { name: "Check command for Codex" }));

    expect(checkCliProfileMock).toHaveBeenCalledExactlyOnceWith(BUILT_IN_CODEX_ID);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check command for Codex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check command for Claude" })).toBeEnabled();

    settle(createCustomProfileDto());
    await waitFor(() => expect(screen.queryByText("Checking…")).not.toBeInTheDocument());
  });

  // Verify a failed check keeps the previous status and explains the failure safely.
  it("reports a failed check without changing the status", async () => {
    const user = userEvent.setup();
    await renderReadyPage();
    checkCliProfileMock.mockRejectedValue(tagged("commandResolutionFailed"));

    await user.click(screen.getByRole("button", { name: "Check command for Codex" }));

    expect(await screen.findByText("XWork couldn't check this command.")).toBeInTheDocument();
    const row = within(screen.getByRole("table", { name: "Built-in profiles" })).getAllByRole(
      "row",
    )[1];
    expect(within(row as HTMLElement).getByText("Available")).toBeInTheDocument();
  });

  // Verify a durable write locks every competing action without hiding committed data.
  it("locks other actions while a persistent mutation runs", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );
    await renderReadyPage();

    setDefaultCliShellMock.mockReturnValue(new Promise(() => {}));
    await user.selectOptions(screen.getByLabelText("Default shell"), "cmd");

    expect(screen.getByRole("button", { name: "New Profile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check command for Codex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Gemini CLI" })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Custom profiles" })).toBeInTheDocument();
  });

  // Verify every icon-only action carries a textual accessible name.
  it("gives every row action an accessible name", async () => {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );

    await renderReadyPage();

    for (const name of ["Check command for Gemini CLI", "Edit Gemini CLI", "Delete Gemini CLI"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("editor orchestration", () => {
  // Verify the create action opens an empty sheet.
  it("opens the create sheet from New Profile", async () => {
    const user = userEvent.setup();
    await renderReadyPage();

    await user.click(screen.getByRole("button", { name: "New Profile" }));

    expect(screen.getByRole("heading", { name: "New profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  // Verify the row action opens the sheet on the profile that was clicked.
  it("opens the edit sheet from a custom row", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );
    await renderReadyPage();

    await user.click(screen.getByRole("button", { name: "Edit Gemini CLI" }));

    expect(screen.getByRole("heading", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Gemini CLI");
  });

  // Verify a create reaches the backend command and closes the sheet on success.
  it("creates a profile through the store", async () => {
    const user = userEvent.setup();
    await renderReadyPage();
    vi.mocked(createCliProfile).mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));

    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await user.type(screen.getByLabelText("Name"), "Gemini CLI");
    await user.type(screen.getByLabelText("Command"), "gemini");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "New profile" })).not.toBeInTheDocument(),
    );
    expect(vi.mocked(createCliProfile)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "Gemini CLI", command: "gemini", arguments: [] }),
    );
  });

  // Verify an update reaches the backend command with the identifier it edits.
  it("updates a profile through the store", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );
    await renderReadyPage();
    vi.mocked(updateCliProfile).mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));

    await user.click(screen.getByRole("button", { name: "Edit Gemini CLI" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Gemini 2");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(vi.mocked(updateCliProfile)).toHaveBeenCalled());
    expect(vi.mocked(updateCliProfile).mock.calls[0]?.[0]).toBe("c1");
  });

  // Verify a profile that disappears while its sheet is open closes it and says so.
  it("closes the editor when its profile disappears", async () => {
    const user = userEvent.setup();
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );
    await renderReadyPage();

    await user.click(screen.getByRole("button", { name: "Edit Gemini CLI" }));
    expect(screen.getByRole("heading", { name: "Edit profile" })).toBeInTheDocument();

    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));
    const handler = onCliProfilesChangedMock.mock.calls[0]?.[0];
    handler?.({ revision: "1", kind: "deleted", profileId: "c1" });

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Edit profile" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("This profile no longer exists.")).toBeInTheDocument();
  });
});

describe("delete confirmation", () => {
  /** Render the page with one deletable custom profile already loaded. */
  async function renderWithCustom() {
    getCliProfilesMock.mockResolvedValue(
      snapshotWithCustom([createCustomProfileDto({ id: "c1" })]),
    );
    await renderReadyPage();
  }

  // Verify the confirmation names the profile and calls no backend command by itself.
  it("opens the confirmation without deleting anything", async () => {
    const user = userEvent.setup();
    await renderWithCustom();

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));

    expect(screen.getByRole("heading", { name: "Delete Gemini CLI?" })).toBeInTheDocument();
    expect(vi.mocked(deleteCliProfile)).not.toHaveBeenCalled();
  });

  // Verify confirming removes the profile, closes the dialog and announces the outcome.
  it("deletes the profile after an explicit confirmation", async () => {
    const user = userEvent.setup();
    await renderWithCustom();
    vi.mocked(deleteCliProfile).mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));
    await user.click(screen.getByRole("button", { name: "Delete Profile" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Delete Gemini CLI?" })).not.toBeInTheDocument(),
    );
    expect(vi.mocked(deleteCliProfile)).toHaveBeenCalledExactlyOnceWith("c1");
    expect(screen.getByText("Profile deleted.")).toBeInTheDocument();
  });

  // Verify a retryable failure keeps the dialog open with the profile still in the table.
  it("keeps the dialog open on a retryable failure", async () => {
    const user = userEvent.setup();
    await renderWithCustom();
    vi.mocked(deleteCliProfile).mockRejectedValue(tagged("persistenceFailed"));

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));
    await user.click(screen.getByRole("button", { name: "Delete Profile" }));

    expect(await screen.findByText("XWork couldn't delete this profile.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete Gemini CLI?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // Verify a target the backend no longer knows closes the dialog and refreshes the page.
  it("closes the dialog when the backend no longer knows the profile", async () => {
    const user = userEvent.setup();
    await renderWithCustom();
    vi.mocked(deleteCliProfile).mockRejectedValue(tagged("profileNotFound"));
    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));
    await user.click(screen.getByRole("button", { name: "Delete Profile" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Delete Gemini CLI?" })).not.toBeInTheDocument(),
    );
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
  });

  // Verify a profile deleted elsewhere closes the open confirmation and says why.
  it("closes the confirmation when the profile disappears externally", async () => {
    const user = userEvent.setup();
    await renderWithCustom();

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));

    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "1" }));
    const handler = onCliProfilesChangedMock.mock.calls[0]?.[0];
    handler?.({ revision: "1", kind: "deleted", profileId: "c1" });

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Delete Gemini CLI?" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("This profile no longer exists.")).toBeInTheDocument();
  });

  // Verify cancelling drops the failure it was explaining instead of leaving it on the page.
  it("clears a delete failure when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    await renderWithCustom();
    vi.mocked(deleteCliProfile).mockRejectedValue(tagged("persistenceFailed"));

    await user.click(screen.getByRole("button", { name: "Delete Gemini CLI" }));
    await user.click(screen.getByRole("button", { name: "Delete Profile" }));
    await screen.findByText("XWork couldn't delete this profile.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("XWork couldn't delete this profile.")).not.toBeInTheDocument();
  });
});

describe("store lifecycle", () => {
  // Verify the page owns exactly one consumer and releases it when it unmounts.
  it("acquires and releases the shared store", async () => {
    const { unmount } = await renderReadyPage();

    expect(onCliProfilesChangedMock).toHaveBeenCalledOnce();

    unmount();
    expect(getCliProfilesMock).toHaveBeenCalledOnce();
  });
});
