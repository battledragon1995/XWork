// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfileInputDto } from "@/bindings/terminal/cli-profiles";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CliProfilesFailure } from "./cli-profile-error-copy";
import { CliProfileEditor, type CliProfileEditorProps } from "./cli-profile-editor";
import {
  createCliProfileDto,
  createCliShellCatalog,
  createCustomProfileDto,
  createStoredSecretDto,
  DUMMY_FE013_SECRET,
} from "./cli-profiles-test-fixture";

/** Callbacks every case can assert against without touching a store or the IPC boundary. */
function baseProps(overrides: Partial<CliProfileEditorProps> = {}): CliProfileEditorProps {
  return {
    open: true,
    mode: "create",
    source: null,
    shells: createCliShellCatalog(),
    failure: null,
    isChecking: false,
    onClose: vi.fn(),
    onSave: vi.fn(async () => true),
    onCheck: vi.fn(),
    onMissing: vi.fn(),
    ...overrides,
  };
}

/** Render the editor inside the one provider the shell supplies for icon-only tooltips. */
function renderEditor(overrides: Partial<CliProfileEditorProps> = {}) {
  const props = baseProps(overrides);
  const view = render(
    <TooltipProvider>
      <CliProfileEditor {...props} />
    </TooltipProvider>,
  );

  /** Re-render the same editor with changed props, as the page does after a refresh. */
  const rerender = (next: Partial<CliProfileEditorProps>) =>
    view.rerender(
      <TooltipProvider>
        <CliProfileEditor {...props} {...next} />
      </TooltipProvider>,
    );

  return { ...view, props, rerender };
}

/** Read the last payload one save attempt produced. */
function lastSavePayload(props: CliProfileEditorProps): CliProfileInputDto {
  const call = vi.mocked(props.onSave).mock.calls.at(-1);
  return call?.[1] as CliProfileInputDto;
}

/** One custom profile with two arguments, one plain and one stored secret variable. */
function savedProfile() {
  return createCustomProfileDto({
    id: "c1",
    name: "Aider",
    command: "aider",
    arguments: ["--model", "o3"],
    icon: "Ai",
    color: "#e8a55a",
    shellId: null,
    environment: [
      { name: "AIDER_DARK_MODE", value: "true", isSecret: false, hasStoredValue: false },
      createStoredSecretDto("OPENAI_API_KEY"),
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("sheet shell", () => {
  // Verify the sheet is pinned to the right edge at the documented width.
  it("renders as a right-side sheet", () => {
    renderEditor();

    const content = screen.getByRole("dialog");
    expect(content.className).toContain("right-0");
    expect(content.className).toContain("w-[min(520px,100vw)]");
  });

  // Verify the sheet body is the only part that scrolls vertically.
  it("scrolls its body independently", () => {
    renderEditor();

    expect(screen.getByTestId("cli-profile-editor-body").className).toContain("overflow-y-auto");
  });

  // Verify each mode names itself and starts with the caret in the Name field.
  it.each([
    ["create", "New profile"],
    ["edit", "Edit profile"],
  ] as const)("titles the %s sheet and focuses Name", async (mode, title) => {
    renderEditor(mode === "edit" ? { mode, source: savedProfile() } : {});

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  // Verify focus returns to whatever opened the sheet once it closes.
  it("restores focus to the opener", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Edit Aider";
    document.body.append(trigger);
    trigger.focus();

    const { rerender } = renderEditor();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());

    rerender({ open: false });
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  // Verify a built-in can never reach the form, whatever the page hands the editor.
  it("refuses to edit a built-in profile", () => {
    renderEditor({ mode: "edit", source: createCliProfileDto() });

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});

describe("create defaults", () => {
  // Verify a new profile starts from the exact FE-013 defaults with no rows at all.
  it("starts from the documented defaults", () => {
    renderEditor();

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Icon")).toHaveValue(">_");
    expect(screen.getByLabelText("Colour")).toHaveValue("#64748b");
    expect((screen.getByLabelText("Shell (optional)") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("No arguments yet.")).toBeInTheDocument();
    expect(screen.getByText("No environment variables yet.")).toBeInTheDocument();
  });

  // Verify the two hints that explain literal arguments and secret storage are present.
  it("renders the argument and secret hints", () => {
    renderEditor();

    expect(
      screen.getByText(
        "Each row is passed as one argument. Values are never joined into a shell string.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Secret values are stored in the operating system credential store and are never shown or exported in backups.",
      ),
    ).toBeInTheDocument();
  });

  // Verify the shell list offers inheritance plus only concrete, available catalog entries.
  it("offers inheritance and available concrete shells only", () => {
    renderEditor();

    const select = screen.getByLabelText("Shell (optional)");
    const labels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels[0]).toBe("Use default shell");
    expect(labels).not.toContain("System default");
    expect(labels).toContain("PowerShell 7");
  });
});

describe("edit mapping", () => {
  // Verify every editable field arrives from the saved profile.
  it("maps a saved profile into the form", () => {
    renderEditor({ mode: "edit", source: savedProfile() });

    expect(screen.getByLabelText("Name")).toHaveValue("Aider");
    expect(screen.getByLabelText("Command")).toHaveValue("aider");
    expect(screen.getByLabelText("Icon")).toHaveValue("Ai");
    expect(screen.getByLabelText("Argument 1")).toHaveValue("--model");
    expect(screen.getByLabelText("Argument 2")).toHaveValue("o3");
    expect(screen.getByLabelText("Variable 1 name")).toHaveValue("AIDER_DARK_MODE");
    expect(screen.getByLabelText("Variable 1 value")).toHaveValue("true");
  });

  // Verify a stored secret is described, never shown, and offers only a replacement.
  it("describes a stored secret without revealing it", () => {
    renderEditor({ mode: "edit", source: savedProfile() });

    expect(screen.getByText("Stored securely")).toBeInTheDocument();
    expect(screen.queryByLabelText("Variable 2 value")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replace value for variable 2" }),
    ).toBeInTheDocument();
  });
});

describe("argument rows", () => {
  // Verify rows can be added, reordered and removed, and that the last one may go.
  it("adds, moves and removes rows", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Add argument" }));
    await user.type(screen.getByLabelText("Argument 1"), "--first");
    await user.click(screen.getByRole("button", { name: "Add argument" }));
    await user.type(screen.getByLabelText("Argument 2"), "--second");

    await user.click(screen.getByRole("button", { name: "Move argument 2 up" }));
    expect(screen.getByLabelText("Argument 1")).toHaveValue("--second");
    expect(screen.getByLabelText("Argument 2")).toHaveValue("--first");

    await user.click(screen.getByRole("button", { name: "Remove argument 1" }));
    expect(screen.getByLabelText("Argument 1")).toHaveValue("--first");

    await user.click(screen.getByRole("button", { name: "Remove argument 1" }));
    expect(screen.getByText("No arguments yet.")).toBeInTheDocument();
  });

  // Verify the ends of the list cannot be moved further out.
  it("disables a move past either end", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Add argument" }));
    await user.click(screen.getByRole("button", { name: "Add argument" }));

    expect(screen.getByRole("button", { name: "Move argument 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move argument 2 down" })).toBeDisabled();
  });
});

describe("icon and colour", () => {
  // Verify the native picker and the hex field always describe the same colour.
  it("synchronizes the picker and the hex field", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.clear(screen.getByLabelText("Colour"));
    await user.type(screen.getByLabelText("Colour"), "#AABBCC");

    expect(screen.getByLabelText("Colour picker")).toHaveValue("#aabbcc");
  });
});

describe("environment rows", () => {
  // Verify a plain row can be added, filled, reordered and removed.
  it("adds, moves and removes variables", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.type(screen.getByLabelText("Variable 1 name"), "FIRST");
    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.type(screen.getByLabelText("Variable 2 name"), "SECOND");

    await user.click(screen.getByRole("button", { name: "Move variable 2 up" }));
    expect(screen.getByLabelText("Variable 1 name")).toHaveValue("SECOND");

    await user.click(screen.getByRole("button", { name: "Remove variable 1" }));
    expect(screen.getByLabelText("Variable 1 name")).toHaveValue("FIRST");
  });

  // Verify turning on Secret masks the field while keeping what the user already typed.
  it("masks a value once Secret is switched on", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.type(screen.getByLabelText("Variable 1 value"), DUMMY_FE013_SECRET);
    await user.click(screen.getByRole("switch", { name: "Variable 1 secret" }));

    const field = screen.getByLabelText("Variable 1 value");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(DUMMY_FE013_SECRET);
  });

  // Verify cancelling a replacement returns to the stored credential without a value.
  it("cancels a replacement back to the stored value", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.click(screen.getByRole("button", { name: "Replace value for variable 2" }));
    await user.type(screen.getByLabelText("Variable 2 value"), DUMMY_FE013_SECRET);
    await user.click(screen.getByRole("button", { name: "Keep stored value for variable 2" }));

    expect(screen.getByText("Stored securely")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(JSON.stringify(lastSavePayload(props))).not.toContain(DUMMY_FE013_SECRET);
  });

  // Verify converting a stored secret to plain text asks for a new, visible value.
  it("requires a new value when a stored secret becomes plain text", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.click(screen.getByRole("switch", { name: "Variable 2 secret" }));
    const field = screen.getByLabelText("Variable 2 value");
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("");

    await user.type(field, "visible");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(lastSavePayload(props).environment[1]).toEqual({
      name: "OPENAI_API_KEY",
      value: "visible",
      isSecret: false,
    });
  });
});

describe("saving", () => {
  // Verify one create sends the whole configuration with every argument kept literal.
  it("sends a create payload with literal arguments", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor();

    await user.type(screen.getByLabelText("Name"), "Gemini CLI");
    await user.type(screen.getByLabelText("Command"), "gemini");
    await user.click(screen.getByRole("button", { name: "Add argument" }));
    await user.type(screen.getByLabelText("Argument 1"), "--model o3");
    await user.click(screen.getByRole("button", { name: "Add argument" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(vi.mocked(props.onSave).mock.calls[0]?.[0]).toBeNull();
    expect(lastSavePayload(props)).toMatchObject({
      name: "Gemini CLI",
      command: "gemini",
      arguments: ["--model o3", ""],
      shellId: undefined,
      icon: ">_",
      color: "#64748b",
    });
  });

  // Verify one update names the profile it replaces and keeps its untouched secret.
  it("sends an update payload that keeps a stored secret", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Aider 2");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(vi.mocked(props.onSave).mock.calls[0]?.[0]).toBe("c1");
    expect(lastSavePayload(props).environment[1]).toEqual({
      name: "OPENAI_API_KEY",
      isSecret: true,
    });
  });

  // Verify a successful save closes the sheet exactly once.
  it("closes the sheet after a successful save", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  });

  // Verify a pending save locks the form and cannot be submitted a second time.
  it("locks the form while a save is pending", async () => {
    const user = userEvent.setup();
    let settle: (accepted: boolean) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    const { props } = renderEditor({ mode: "edit", source: savedProfile(), onSave });

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    settle(true);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledOnce();
  });

  // Verify local validation blocks the call and puts the first message where focus lands.
  it("blocks an invalid draft and focuses the first bad field", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByText("Enter a name between 1 and 80 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  // Verify a field message is wired to its control for assistive technology.
  it("associates a field error with its input", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText("Name"), "Gemini");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    const command = screen.getByLabelText("Command");
    const describedBy = command.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent("Enter a command.");
  });

  // Verify a duplicate environment name blocks the save on both rows.
  it("blocks a duplicate environment name", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor();

    await user.type(screen.getByLabelText("Name"), "Gemini");
    await user.type(screen.getByLabelText("Command"), "gemini");
    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.type(screen.getByLabelText("Variable 1 name"), "TOKEN");
    await user.click(screen.getByRole("button", { name: "Add variable" }));
    await user.type(screen.getByLabelText("Variable 2 name"), "token");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(props.onSave).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Environment names must be unique, ignoring upper and lower case."),
    ).toHaveLength(2);
  });
});

describe("backend failures", () => {
  /** Build the failure shape the store hands the editor. */
  function failure(code: CliProfilesFailure["code"], message: string): CliProfilesFailure {
    return { code, operation: "update", profileId: "c1", retryable: false, message };
  }

  // Verify an input rejection is placed next to the field it belongs to.
  it("places a backend input rejection on its field", () => {
    renderEditor({
      mode: "edit",
      source: savedProfile(),
      failure: failure("invalidCommand", "Enter a bare executable name or an absolute path."),
    });

    const command = screen.getByLabelText("Command");
    expect(command).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Enter a bare executable name or an absolute path."),
    ).toBeInTheDocument();
  });

  // Verify a credential failure is a safe banner that names no secret and keeps the draft.
  it("shows a credential failure as a safe banner", async () => {
    const user = userEvent.setup();
    renderEditor({
      mode: "edit",
      source: savedProfile(),
      failure: failure(
        "credentialStoreUnavailable",
        "XWork couldn't reach the operating system credential store.",
      ),
    });

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Aider 2");

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("XWork couldn't reach the operating system credential store.");
    expect(banner).not.toHaveTextContent("OPENAI_API_KEY");
    expect(screen.getByLabelText("Name")).toHaveValue("Aider 2");
  });

  // Verify a rejection that names no field is announced at the top of the sheet instead.
  it("shows an unplaceable rejection as a sheet banner", () => {
    renderEditor({
      mode: "edit",
      source: savedProfile(),
      failure: failure("persistenceFailed", "XWork couldn't save this profile."),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't save this profile.");
  });
});

describe("check command", () => {
  // Verify a clean saved profile can be re-checked from inside the sheet.
  it("checks a clean saved profile", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.click(screen.getByRole("button", { name: "Check command" }));

    expect(props.onCheck).toHaveBeenCalledExactlyOnceWith("c1");
  });

  // Verify a dirty or brand new draft cannot check stale saved data.
  it.each([
    ["a new profile", {} as Partial<CliProfileEditorProps>],
    ["a dirty profile", { mode: "edit", source: savedProfile() } as Partial<CliProfileEditorProps>],
  ])("disables the check for %s", async (label, overrides) => {
    const user = userEvent.setup();
    renderEditor(overrides);

    if (label === "a dirty profile") {
      await user.type(screen.getByLabelText("Name"), "!");
    }

    expect(screen.getByRole("button", { name: "Check command" })).toBeDisabled();
    expect(screen.getByText("Save changes before checking.")).toBeInTheDocument();
  });
});

describe("external changes", () => {
  // Verify a clean editor silently follows an external edit of the same profile.
  it("resynchronizes a clean draft", () => {
    const { rerender } = renderEditor({ mode: "edit", source: savedProfile() });

    rerender({ source: createCustomProfileDto({ ...savedProfile(), name: "Renamed elsewhere" }) });

    expect(screen.getByLabelText("Name")).toHaveValue("Renamed elsewhere");
  });

  // Verify a background availability change alone never disturbs the open sheet.
  it("ignores an availability-only refresh", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.type(screen.getByLabelText("Name"), "!");
    rerender({
      source: createCustomProfileDto({
        ...savedProfile(),
        availability: { status: "commandNotFound", checkedAtUnixMs: "1800000000000" },
      }),
    });

    expect(screen.getByLabelText("Name")).toHaveValue("Aider!");
    expect(
      screen.queryByText("This profile changed in XWork. Reload it before saving."),
    ).not.toBeInTheDocument();
  });

  // Verify a dirty editor refuses to overwrite an external edit until it is reloaded.
  it("blocks a dirty save on an external change and reloads on request", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.type(screen.getByLabelText("Name"), "!");
    rerender({ source: createCustomProfileDto({ ...savedProfile(), command: "aider2" }) });

    expect(
      screen.getByText("This profile changed in XWork. Reload it before saving."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reload Profile" }));

    expect(screen.getByLabelText("Command")).toHaveValue("aider2");
    expect(screen.getByLabelText("Name")).toHaveValue("Aider");
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // Verify a profile that disappears closes the sheet instead of saving into nothing.
  it("reports a profile that no longer exists", () => {
    const { props, rerender } = renderEditor({ mode: "edit", source: savedProfile() });

    rerender({ source: null });

    expect(props.onMissing).toHaveBeenCalledOnce();
  });
});

describe("closing", () => {
  // Verify a clean sheet closes immediately from every dismissal path.
  it.each(["Close", "Cancel"])("closes a clean sheet from %s", async (name) => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.click(screen.getByRole("button", { name }));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "Discard profile changes?" })).toBeNull();
  });

  // Verify Escape closes a clean sheet without asking anything.
  it("closes a clean sheet with Escape", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.keyboard("{Escape}");

    expect(props.onClose).toHaveBeenCalledOnce();
  });

  // Verify every dirty dismissal path reaches the same destructive confirmation.
  it.each([
    [
      "the Close button",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Close" })),
    ],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ])("confirms before discarding from %s", async (_label, dismiss) => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.type(screen.getByLabelText("Name"), "!");
    await dismiss(user);

    expect(screen.getByRole("heading", { name: "Discard profile changes?" })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard Profile Changes" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  // Verify keeping the changes returns to the editor with the draft intact.
  it("returns to the editor when the discard is cancelled", async () => {
    const user = userEvent.setup();
    const { props } = renderEditor({ mode: "edit", source: savedProfile() });

    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));

    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Aider!");
  });
});
