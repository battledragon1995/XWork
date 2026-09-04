// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsDto, SettingsError } from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings, restoreAppearanceDefaults, updateSettings } from "@/lib/ipc/settings";
import { resetMatchMediaStub } from "@/test-setup";
import { SettingsAppearanceRoute } from "./settings-appearance-route";
import { resetSettingsStore, useSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const updateSettingsMock = vi.mocked(updateSettings);
const restoreAppearanceDefaultsMock = vi.mocked(restoreAppearanceDefaults);

/** Create one promise whose settlement a test controls explicitly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Wrap one complete generated error payload as the failure a write command produces. */
function saveError(payload: SettingsError): IpcCallError<SettingsError> {
  return new IpcCallError("update_settings", payload);
}

/** Put the shared store into its ready state and render the page over that snapshot. */
function renderReady(snapshot: AppSettingsDto = createSettingsSnapshot()) {
  useSettingsStore.setState({ status: "ready", snapshot });
  return render(<SettingsAppearanceRoute />);
}

/** Read the Appearance patch of the nth `update_settings` call. */
function patchOf(callIndex: number) {
  return updateSettingsMock.mock.calls[callIndex]?.[0]?.appearance;
}

/** Read one theme-mode choice, which shares its labels with the colour scheme toggle. */
function themeRadio(name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name });
}

/** Read one hex text field by its row label. */
function hexField(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("SettingsAppearanceRoute", () => {
  beforeEach(() => {
    resetSettingsStore();
    resetMatchMediaStub();
    getSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
    updateSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
    restoreAppearanceDefaultsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
  });

  afterEach(() => {
    cleanup();
    resetSettingsStore();
    resetMatchMediaStub();
  });

  // Verify the page header, description and restore action match the wireframe exactly.
  it("renders the exact header", () => {
    renderReady();

    expect(screen.getByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Theme, colours and text size. Changes preview live in the window behind this panel.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore default theme" })).toBeEnabled();
  });

  // Verify all six rows are present, in order, with their exact labels and sub-lines.
  it("renders the six rows in order", () => {
    renderReady();

    const labels = [
      "Theme",
      "Preset",
      "Interface colours",
      "Terminal palette",
      "Interface text size",
      "Terminal text size",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Follow the operating system or pin one mode.")).toBeInTheDocument();
    expect(
      screen.getByText("Pick a starting point, then adjust colours below."),
    ).toBeInTheDocument();
    expect(screen.getByText("Accent is used for primary actions only.")).toBeInTheDocument();
    expect(screen.getByText("Background, foreground and the 16 ANSI colours.")).toBeInTheDocument();
  });

  // Verify the theme group offers all three modes with the stored one selected.
  it("renders the three theme modes", () => {
    renderReady();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Light", "Dark", "System"]);
    expect(within(group).getByRole("radio", { name: "System" })).toBeChecked();
  });

  // Verify the three preset cards are offered and the stored preset is the selected card.
  it("renders the three preset cards", () => {
    renderReady();

    const group = screen.getByRole("radiogroup", { name: "Preset" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: /Cream/ })).toBeChecked();
    expect(screen.queryByText("Custom colours")).not.toBeInTheDocument();
  });

  // Verify a customized palette selects no card and states the customized condition.
  it("shows the custom state", () => {
    renderReady(createSettingsSnapshot({}, { themePreset: "custom" }));

    const group = screen.getByRole("radiogroup", { name: "Preset" });
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getByText("Custom colours")).toBeInTheDocument();
  });

  // Verify the four interface colour rows and both terminal rows carry their exact labels.
  it("renders every colour row", () => {
    renderReady();

    for (const label of ["Accent", "Canvas", "Sidebar", "Text", "Background", "Foreground"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
      expect(screen.getByLabelText(`${label} colour picker`)).toBeInTheDocument();
    }
    for (let index = 0; index < 16; index += 1) {
      expect(screen.getByLabelText(`ANSI ${index}`)).toBeInTheDocument();
    }
  });

  // Verify the static preview shows the wireframe sample and can contain its own overflow.
  it("renders the static terminal preview", () => {
    renderReady();

    const preview = screen.getByLabelText("Terminal preview");
    expect(preview).toHaveTextContent("PS F:\\Self Projects\\XWork> pnpm test");
    expect(preview).toHaveTextContent("project-card.test.tsx");
    expect(preview).toHaveTextContent("1 skipped");
    expect(preview).toHaveTextContent("0 failed");
    expect(preview.className).toContain("overflow-x-auto");
  });

  // Verify both sliders expose their bounds, step and current value to assistive technology.
  it("renders both sliders with their bounds", () => {
    renderReady();

    const interfaceSlider = screen.getByRole("slider", { name: "Interface text size" });
    expect(interfaceSlider).toHaveAttribute("aria-valuemin", "12");
    expect(interfaceSlider).toHaveAttribute("aria-valuemax", "20");
    expect(interfaceSlider).toHaveAttribute("aria-valuenow", "14");

    const terminalSlider = screen.getByRole("slider", { name: "Terminal text size" });
    expect(terminalSlider).toHaveAttribute("aria-valuemin", "10");
    expect(terminalSlider).toHaveAttribute("aria-valuemax", "24");
    expect(terminalSlider).toHaveAttribute("aria-valuenow", "13");
    expect(screen.getByText("14 px")).toBeInTheDocument();
    expect(screen.getByText("13 px")).toBeInTheDocument();
  });

  // Verify the loading state keeps the header while offering no control at all.
  it("renders the loading state", () => {
    useSettingsStore.setState({ status: "loading", snapshot: null });
    render(<SettingsAppearanceRoute />);

    expect(screen.getByText("Loading settings…")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore default theme" })).toBeDisabled();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  // Verify a retryable read failure reuses the FE-011 recovery path.
  it("retries a retryable read failure", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ status: "error", snapshot: null, errorCode: "unavailable" });
    render(<SettingsAppearanceRoute />);

    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't read settings right now.");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(getSettingsMock).toHaveBeenCalledOnce();
  });

  // Verify a data-integrity read failure offers no retry at all.
  it("offers no retry for an integration read failure", () => {
    useSettingsStore.setState({
      status: "error",
      snapshot: null,
      errorCode: "corrupt_stored_settings",
    });
    render(<SettingsAppearanceRoute />);

    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't read its saved settings.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Verify choosing a mode sends exactly that field and nothing else.
  it("sends the theme mode patch", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(patchOf(0)).toEqual({ themeMode: "dark" });
  });

  // Verify the mode group can be operated entirely from the keyboard.
  it("moves through the theme group with the arrow keys", async () => {
    const user = userEvent.setup();
    renderReady();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    within(group).getByRole("radio", { name: "System" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(patchOf(0)).toEqual({ themeMode: "dark" });
  });

  // Verify choosing a preset sends only the preset, with no locally invented colours.
  it("sends the preset patch alone", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.click(screen.getByRole("radio", { name: /Paper/ }));

    expect(patchOf(0)).toEqual({ themePreset: "paper" });
  });

  // Verify an interface colour edit sends both complete schemes and no preset.
  it("sends both interface schemes after the quiet period", async () => {
    vi.useFakeTimers();
    try {
      renderReady();

      fireEvent.change(hexField("Accent"), { target: { value: "#3b6ea8" } });
      act(() => vi.advanceTimersByTime(300));

      const patch = patchOf(0);
      expect(Object.keys(patch ?? {})).toEqual(["interfaceColors"]);
      expect(patch?.interfaceColors?.light.accent).toBe("#3b6ea8");
      expect(patch?.interfaceColors?.dark.accent).toBe("#e08a6c");
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify the Light/Dark toggle edits the inactive set without changing the theme mode.
  it("edits the inactive interface scheme", async () => {
    vi.useFakeTimers();
    try {
      renderReady();

      const toggle = screen.getByRole("radiogroup", { name: "Interface colours scheme" });
      fireEvent.click(within(toggle).getByRole("radio", { name: "Dark" }));
      expect(hexField("Canvas")).toHaveValue("#1e1b18");
      expect(updateSettingsMock).not.toHaveBeenCalled();

      fireEvent.change(hexField("Canvas"), { target: { value: "#101010" } });
      act(() => vi.advanceTimersByTime(300));

      const patch = patchOf(0);
      expect(patch?.interfaceColors?.dark.canvas).toBe("#101010");
      expect(patch?.themeMode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify a terminal edit sends the complete palette with all sixteen ANSI slots.
  it("sends the complete terminal palette", async () => {
    vi.useFakeTimers();
    try {
      renderReady();

      fireEvent.change(hexField("ANSI 5"), { target: { value: "#123456" } });
      act(() => vi.advanceTimersByTime(300));

      const palette = patchOf(0)?.terminalPalette;
      expect(Object.keys(patchOf(0) ?? {})).toEqual(["terminalPalette"]);
      expect(palette?.ansiColors).toHaveLength(16);
      expect(palette?.ansiColors[5]).toBe("#123456");
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify each size row sends only its own field after the quiet period.
  it("sends a size patch from the keyboard", async () => {
    vi.useFakeTimers();
    try {
      renderReady();

      const slider = screen.getByRole("slider", { name: "Interface text size" });
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      act(() => vi.advanceTimersByTime(300));

      expect(patchOf(0)).toEqual({ interfaceFontSizePx: 15 });
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify Home and End reach the documented bounds of each slider.
  it.each([
    ["Interface text size", "Home", 12],
    ["Interface text size", "End", 20],
    ["Terminal text size", "Home", 10],
    ["Terminal text size", "End", 24],
  ] as const)("moves %s to its %s bound", async (name, key, expected) => {
    vi.useFakeTimers();
    try {
      renderReady();

      const slider = screen.getByRole("slider", { name });
      slider.focus();
      fireEvent.keyDown(slider, { key });
      act(() => vi.advanceTimersByTime(300));

      expect(slider).toHaveAttribute("aria-valuenow", String(expected));
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify malformed text never reaches the backend and is reported on its own row.
  it("blocks a malformed colour locally", async () => {
    const user = userEvent.setup();
    renderReady();

    await user.clear(hexField("Accent"));
    await user.type(hexField("Accent"), "#abc");
    await user.tab();

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByText("Use a #rrggbb colour.")).toBeInTheDocument();
  });

  // Verify a low-contrast pair previews, explains the threshold, and is never sent.
  it("blocks a low-contrast pair locally", async () => {
    vi.useFakeTimers();
    try {
      renderReady();

      fireEvent.change(hexField("Text"), { target: { value: "#f2f2f2" } });
      act(() => vi.advanceTimersByTime(300));

      expect(updateSettingsMock).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().appearanceDraft?.interfaceColors.light.text).toBe(
        "#f2f2f2",
      );
      expect(
        screen.getByText(/Text \(Light\) on Canvas \(Light\) needs at least 4.5:1 contrast/),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify the saving state is announced politely while every control stays usable.
  it("announces saving without disabling editing", async () => {
    const pending = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(themeRadio("Light")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore default theme" })).toBeDisabled();

    await act(async () => {
      pending.resolve(createSettingsSnapshot());
      await pending.promise;
    });
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  });

  // Verify restore reaches the backend with no confirmation step in between.
  it("restores without a confirmation dialog", async () => {
    const user = userEvent.setup();
    renderReady(createSettingsSnapshot({}, { themeMode: "dark", interfaceFontSizePx: 20 }));

    await user.click(screen.getByRole("button", { name: "Restore default theme" }));

    expect(restoreAppearanceDefaultsMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Interface text size" })).toHaveAttribute(
      "aria-valuenow",
      "14",
    );
  });

  // Verify a retryable restore failure offers exactly one retry action.
  it("retries a failed restore", async () => {
    restoreAppearanceDefaultsMock.mockRejectedValueOnce(saveError({ code: "persistence_failed" }));
    const user = userEvent.setup();
    renderReady();

    await user.click(screen.getByRole("button", { name: "Restore default theme" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "XWork couldn't save your appearance settings to storage.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(restoreAppearanceDefaultsMock).toHaveBeenCalledTimes(2);
  });

  // Verify a retryable write failure repeats the exact patch that failed.
  it("retries the exact failed patch", async () => {
    updateSettingsMock.mockRejectedValueOnce(saveError({ code: "unavailable" }));
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "XWork couldn't save your appearance settings right now.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(patchOf(1)).toEqual({ themeMode: "dark" });
  });

  // Verify a rejected colour is reported both on the page and on the row the backend named.
  it("shows a backend colour rejection on its own row", async () => {
    updateSettingsMock.mockRejectedValueOnce(
      saveError({ code: "invalid_color", field: "interfaceColors.light.accent" }),
    );
    vi.useFakeTimers();
    try {
      renderReady();

      fireEvent.change(hexField("Accent"), { target: { value: "#3b6ea8" } });
      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
      });

      const message = "XWork couldn't save interfaceColors.light.accent. Use a #rrggbb colour.";
      expect(screen.getAllByText(message).length).toBeGreaterThan(0);
      expect(hexField("Accent")).toHaveAttribute("aria-invalid", "true");
      expect(hexField("Canvas")).not.toHaveAttribute("aria-invalid");
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify a defensive backend contrast rejection is attached to the right colour group.
  it("shows a backend contrast rejection beside its group", async () => {
    updateSettingsMock.mockRejectedValueOnce(
      saveError({
        code: "contrast_too_low",
        foreground: "terminalPalette.foreground",
        background: "terminalPalette.background",
      }),
    );
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(hexField("Foreground")).toHaveAttribute("aria-invalid", "true");
    expect(hexField("Accent")).not.toHaveAttribute("aria-invalid");
  });

  // Verify an out-of-range rejection names the valid range and offers no retry.
  it("reports an out-of-range rejection without a retry", async () => {
    updateSettingsMock.mockRejectedValueOnce(
      saveError({ code: "value_out_of_range", field: "interfaceFontSizePx", min: 12, max: 20 }),
    );
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "XWork couldn't save interfaceFontSizePx. Use a value between 12 and 20.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Verify an unrecognized backend field keeps the page alert without a wrong row error.
  it("keeps an unrecognized field at page level", async () => {
    updateSettingsMock.mockRejectedValueOnce(
      saveError({ code: "invalid_color", field: "somethingElse.newField" }),
    );
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("somethingElse.newField");
    expect(hexField("Accent")).not.toHaveAttribute("aria-invalid");
  });

  // Verify every discard-class rejection returns the controls to the committed snapshot.
  it.each([
    "invalid_preset_combination",
    "empty_patch",
    "unauthorized_window",
    "corrupt_stored_settings",
  ] as const)("returns to the snapshot after %s", async (code) => {
    updateSettingsMock.mockRejectedValueOnce(saveError({ code, field: "x" } as SettingsError));
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));

    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
    expect(themeRadio("System")).toBeChecked();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Verify rapid edits during a held write are coalesced into one later request.
  it("coalesces rapid edits behind a held write", async () => {
    const pending = deferred<AppSettingsDto>();
    updateSettingsMock.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderReady();

    await user.click(themeRadio("Dark"));
    await user.click(themeRadio("Light"));
    await user.click(themeRadio("System"));
    expect(updateSettingsMock).toHaveBeenCalledOnce();

    updateSettingsMock.mockResolvedValueOnce(createSettingsSnapshot());
    await act(async () => {
      pending.resolve(createSettingsSnapshot());
      await pending.promise;
    });

    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(patchOf(1)).toEqual({ themeMode: "system" });
  });

  // Verify leaving the page immediately after a final edit still persists it.
  it("flushes a pending commit when the page unmounts", () => {
    vi.useFakeTimers();
    try {
      const view = renderReady();

      fireEvent.change(hexField("Accent"), { target: { value: "#3b6ea8" } });
      view.unmount();

      expect(updateSettingsMock).toHaveBeenCalledOnce();
      expect(patchOf(0)?.interfaceColors?.light.accent).toBe("#3b6ea8");
    } finally {
      vi.useRealTimers();
    }
  });

  // Verify leaving the page with an unsaveable preview returns the window to the snapshot.
  it("discards an unsaveable preview when the page unmounts", () => {
    vi.useFakeTimers();
    try {
      const view = renderReady();

      fireEvent.change(hexField("Text"), { target: { value: "#f2f2f2" } });
      expect(useSettingsStore.getState().appearanceDraft).not.toBeNull();

      view.unmount();

      expect(useSettingsStore.getState().appearanceDraft).toBeNull();
      expect(updateSettingsMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
