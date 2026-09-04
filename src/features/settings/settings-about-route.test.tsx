import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAppInfo } from "@/lib/ipc/app-info";
import { SettingsAboutRoute } from "./settings-about-route";

vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));

const readAppInfoMock = vi.mocked(readAppInfo);
const APP_INFO = {
  appVersion: "0.0.0",
  osPlatform: "windows",
  osVersion: "11.0.26100",
  osArch: "x86_64",
};

describe("SettingsAboutRoute", () => {
  // Remove previous calls and DOM before each page state.
  beforeEach(() => {
    readAppInfoMock.mockReset();
  });

  // Unmount the hook so late adapter work cannot leak between tests.
  afterEach(() => {
    cleanup();
  });

  // Verify stable branding appears while the details remain pending.
  it("shows branding and the loading state immediately", () => {
    readAppInfoMock.mockReturnValue(new Promise(() => {}));
    render(<SettingsAboutRoute />);

    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.getByText("XWork")).toBeInTheDocument();
    expect(screen.getByText("Loading application details…")).toHaveAttribute("aria-busy", "true");
  });

  // Verify app version and both OS rows render without changing backend values.
  it("renders the real application and Windows details", async () => {
    readAppInfoMock.mockResolvedValue(APP_INFO);
    render(<SettingsAboutRoute />);

    expect(await screen.findByText("Version 0.0.0")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Windows 11.0.26100" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "x86_64" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  // Verify macOS is title-cased while an unknown platform identifier is preserved.
  it.each([
    ["macos", "macOS 15.6"],
    ["freebsd", "freebsd 14.3"],
  ])("maps %s to its specified display label", async (osPlatform, expected) => {
    readAppInfoMock.mockResolvedValue({
      ...APP_INFO,
      osPlatform,
      osVersion: expected.split(" ")[1],
    });
    render(<SettingsAboutRoute />);

    expect(await screen.findByRole("cell", { name: expected })).toBeInTheDocument();
  });

  // Verify failure keeps branding, offers retry, and collapses repeated clicks to one read.
  it("retries a failed app-info read once", async () => {
    readAppInfoMock.mockRejectedValueOnce(new Error("denied"));
    readAppInfoMock.mockReturnValueOnce(new Promise(() => {}));
    render(<SettingsAboutRoute />);
    const retry = await screen.findByRole("button", { name: "Try again" });

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(readAppInfoMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("XWork")).toBeInTheDocument();
    expect(screen.getByText("Loading application details…")).toBeInTheDocument();
  });

  // Verify the table owns narrow overflow and deferred About affordances remain absent.
  it("keeps overflow local and omits deferred controls", async () => {
    readAppInfoMock.mockResolvedValue(APP_INFO);
    render(<SettingsAboutRoute />);
    await screen.findByText("Version 0.0.0");

    expect(screen.getByTestId("app-info-table-scroll")).toHaveClass("overflow-x-auto");
    for (const text of [
      "Documentation",
      "License",
      "Report an issue",
      "Copy diagnostics",
      "WebView2",
      "Terminal backend",
      "Default shell",
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });
});
