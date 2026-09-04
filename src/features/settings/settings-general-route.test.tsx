import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings } from "@/lib/ipc/settings";
import { SettingsGeneralRoute } from "./settings-general-route";
import { resetSettingsStore, retainSettingsArea, useSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({ getSettings: vi.fn() }));

const getSettingsMock = vi.mocked(getSettings);

/** Publish one complete snapshot directly so page tests stay independent of frame loading. */
function publishReady(general: Parameters<typeof createSettingsSnapshot>[0] = {}) {
  useSettingsStore.setState({
    status: "ready",
    snapshot: createSettingsSnapshot(general),
    errorCode: null,
  });
}

describe("SettingsGeneralRoute", () => {
  // Reset feature state and command behavior before each page test.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset();
  });

  // Remove the component and invalidate any unfinished retry.
  afterEach(() => {
    cleanup();
    resetSettingsStore();
  });

  // Verify the loading state keeps section context and contains no invented controls.
  it("renders the General loading state", () => {
    useSettingsStore.setState({ status: "loading", snapshot: null, errorCode: null });
    render(<SettingsGeneralRoute />);

    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Loading settings…")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  // Verify the five exact rows are shown and the omitted autostart row stays omitted.
  it("renders the exact read-only General rows", () => {
    publishReady();
    render(<SettingsGeneralRoute />);

    for (const text of [
      "Interface language",
      "More languages will arrive in a later release.",
      "Closing the window hides XWork to the tray",
      "Terminals, AI CLIs and reminders keep running. Use Quit XWork to stop everything.",
      "Show tray icon",
      "Turning this off means the window can only be reopened from the taskbar.",
      "Ask before quitting",
      "Shows how many sessions and processes will be stopped.",
      "Open at Home on launch",
      "XWork always opens at Home. Sessions are not restored after Quit.",
      "English",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText("Start XWork when I sign in")).not.toBeInTheDocument();
  });

  // Verify true and false backend booleans reach disabled, non-tabbable switches unchanged.
  it("binds every disabled switch to the snapshot", async () => {
    const user = userEvent.setup();
    publishReady({ showTrayIcon: false, openAtHomeOnLaunch: false });
    render(<SettingsGeneralRoute />);
    const switches = screen.getAllByRole("switch");

    expect(switches).toHaveLength(4);
    expect(switches.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "true",
      "false",
    ]);
    for (const item of switches) {
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute("tabindex", "-1");
    }

    await user.tab();
    expect(switches).not.toContain(document.activeElement);
  });

  // Verify retryable failures offer one deduplicated command retry and hide fake rows.
  it.each(["unavailable", "persistence_failed"] as const)(
    "retries the %s failure once while loading",
    async (errorCode) => {
      const user = userEvent.setup();
      const release = retainSettingsArea();
      useSettingsStore.setState({ status: "error", snapshot: null, errorCode });
      getSettingsMock.mockReturnValue(new Promise(() => {}));
      render(<SettingsGeneralRoute />);

      const retry = screen.getByRole("button", { name: "Try again" });
      await user.dblClick(retry);

      expect(getSettingsMock).toHaveBeenCalledOnce();
      expect(screen.getByText("Loading settings…")).toBeInTheDocument();
      expect(screen.queryByText("Interface language")).not.toBeInTheDocument();
      release();
    },
  );

  // Verify corrupt, impossible, and unknown failures require restart without a retry button.
  it.each(["corrupt_stored_settings", "unauthorized_window", "unknown"] as const)(
    "does not retry the %s failure",
    (errorCode) => {
      useSettingsStore.setState({ status: "error", snapshot: null, errorCode });
      render(<SettingsGeneralRoute />);

      expect(screen.getByRole("alert")).toHaveTextContent("Restart XWork.");
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
      expect(getSettingsMock).not.toHaveBeenCalled();
    },
  );

  // Verify a typed retry failure can be represented without importing any mutation boundary.
  it("shows the retry state for a normalized read error", async () => {
    const release = retainSettingsArea();
    getSettingsMock.mockRejectedValue(new IpcCallError("get_settings", { code: "unavailable" }));
    await useSettingsStore.getState().load();
    render(<SettingsGeneralRoute />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    release();
  });
});
