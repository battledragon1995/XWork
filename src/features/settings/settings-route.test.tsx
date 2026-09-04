import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "@/lib/ipc/settings";
import { SETTINGS_SECTIONS } from "./settings-nav";
import { SettingsRoute } from "./settings-route";
import { resetSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({ getSettings: vi.fn() }));

const getSettingsMock = vi.mocked(getSettings);

/** Render the Settings frame with tiny child elements so the frame lifecycle stays real. */
function renderSettings(path = "/settings/general", strict = false) {
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsRoute />,
        children: SETTINGS_SECTIONS.map((section) => ({
          path: section.slug,
          element: <h1>{section.label}</h1>,
        })),
      },
    ],
    { initialEntries: [path] },
  );
  const view = <RouterProvider router={router} />;
  return render(strict ? <StrictMode>{view}</StrictMode> : view);
}

describe("SettingsRoute", () => {
  // Start every frame test with one deterministic backend snapshot.
  beforeEach(() => {
    resetSettingsStore();
    getSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
  });

  // Remove mounted frames before invalidating shared state.
  afterEach(() => {
    cleanup();
    resetSettingsStore();
  });

  // Verify the labelled list exposes all seven destinations in wireframe order without a nav.
  it("renders the seven Settings links without another navigation landmark", () => {
    renderSettings();
    const list = screen.getByRole("list", { name: "Settings sections" });
    const links = within(list).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual(
      SETTINGS_SECTIONS.map((section) => section.label),
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SETTINGS_SECTIONS.map((section) => section.path),
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  // Verify selected state follows every child URL rather than feature-local state.
  it.each(SETTINGS_SECTIONS)("marks $label active at $path", (section) => {
    renderSettings(section.path);

    expect(screen.getByRole("link", { name: section.label })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // Verify keyboard navigation changes only the outlet and does not reread Settings.
  it("keeps the frame and snapshot read across child navigation", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "General" });

    const appearance = screen.getByRole("link", { name: "Appearance" });
    appearance.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(appearance).toHaveClass("focus-visible:ring-2");
    expect(getSettingsMock).toHaveBeenCalledOnce();
  });

  // Verify fixed and shrinkable tracks are encoded on the frame itself.
  it("keeps a 220px navigation track and a shrinkable content track", () => {
    const { container } = renderSettings();

    expect(container.firstElementChild).toHaveClass("grid-cols-[220px_minmax(0,1fr)]", "min-w-0");
  });

  // Verify React development effect remounting adopts one pending settings call.
  it("does not duplicate the initial call in StrictMode", () => {
    getSettingsMock.mockReturnValue(new Promise(() => {}));
    renderSettings("/settings/general", true);

    expect(getSettingsMock).toHaveBeenCalledOnce();
  });
});
