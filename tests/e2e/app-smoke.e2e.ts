import { $, browser, expect } from "@wdio/globals";

/** The five areas the sidebar reaches, with the heading and breadcrumb each one shows. */
const AREAS = [
  { link: "Home", heading: "Home", crumb: "Home" },
  { link: "Projects", heading: "Projects", crumb: "Projects" },
  { link: "Notes", heading: "Notes", crumb: "Notes" },
  { link: "Calendar", heading: "Calendar", crumb: "Calendar" },
  { link: "Settings", heading: "Settings", crumb: "Settings" },
] as const;

/** One snapshot of the shell as the real webview currently renders it. */
interface ShellSnapshot {
  hasBanner: boolean;
  hasNavigation: boolean;
  hasMain: boolean;
  hasWordmarkMenu: boolean;
  isTopbarDragRegion: boolean;
  reservedEntries: string[];
  heading: string | null;
  breadcrumb: string[];
  currentArea: string | null;
  sidebarWidth: number;
  collapseLabel: string | null;
}

/**
 * Read everything the assertions need in a single round trip. Every WebDriver command through
 * tauri-driver costs several seconds on Windows, so one script beats dozens of element calls.
 * The script still runs inside the built application's own WebView2, so this stays a
 * desktop-level observation of the real shell.
 */
async function readShell(): Promise<ShellSnapshot> {
  return JSON.parse(
    await browser.execute(() =>
      JSON.stringify({
        hasBanner: document.querySelector("header") !== null,
        hasNavigation: document.querySelector("nav[aria-label='Main']") !== null,
        hasMain: document.querySelector("main") !== null,
        hasWordmarkMenu: document.querySelector("button[aria-label='XWork menu']") !== null,
        isTopbarDragRegion:
          document.querySelector("header")?.hasAttribute("data-tauri-drag-region") === true,
        reservedEntries: [...document.querySelectorAll("header button[aria-disabled='true']")].map(
          (entry) => (entry.getAttribute("aria-label") ?? entry.textContent ?? "").trim(),
        ),
        heading: document.querySelector("main h1")?.textContent ?? null,
        breadcrumb: [...document.querySelectorAll("ol[aria-label='Breadcrumb'] li")].map((crumb) =>
          (crumb.textContent ?? "").trim(),
        ),
        currentArea:
          document
            .querySelector("nav[aria-label='Main'] a[aria-current='page']")
            ?.textContent?.trim() ?? null,
        sidebarWidth: Math.round(
          document.querySelector("nav[aria-label='Main']")?.getBoundingClientRect().width ?? -1,
        ),
        collapseLabel:
          document
            .querySelector("nav[aria-label='Main'] button[aria-label$='sidebar']")
            ?.getAttribute("aria-label") ?? null,
      }),
    ),
  );
}

// Locate one sidebar area link by its label. The `=text` shorthand cannot be combined with a
// CSS prefix, so the area links are addressed by XPath.
function areaLink(label: string) {
  return $(`//nav[@aria-label='Main']//a[normalize-space(.)='${label}']`);
}

// Groups assertions for the shell rendered by the real desktop runtime.
describe("XWork desktop shell", () => {
  // Absorb the webview startup here rather than in the first assertion.
  before(async () => {
    await browser.waitUntil(async () => (await readShell()).sidebarWidth > 0, {
      timeout: 60_000,
      interval: 1_000,
      timeoutMsg: "The application shell never became visible.",
    });
  });

  // Verify the frameless shell publishes its landmarks, brand entry point and drag surface,
  // and that both future entry points are present but inert.
  it("renders the accessible application shell", async () => {
    const shell = await readShell();

    expect(shell.hasBanner).toBe(true);
    expect(shell.hasNavigation).toBe(true);
    expect(shell.hasMain).toBe(true);
    expect(shell.hasWordmarkMenu).toBe(true);
    expect(shell.isTopbarDragRegion).toBe(true);
    expect(shell.reservedEntries).toEqual(["Search or run a command", "Notifications"]);
  });

  // Verify each sidebar area navigates and updates the heading, breadcrumb and current marker.
  it("navigates every area and updates the context", async () => {
    for (const area of AREAS) {
      await areaLink(area.link).click();
      const shell = await readShell();

      expect(shell.heading).toBe(area.heading);
      expect(shell.breadcrumb).toEqual([area.crumb]);
      expect(shell.currentArea).toBe(area.link);
    }

    // Leave the shell on Home so the remaining scenario starts from the documented state.
    await areaLink("Home").click();
  });

  // Verify the collapse control switches the sidebar between both documented widths.
  it("collapses and expands the sidebar", async () => {
    expect((await readShell()).sidebarWidth).toBe(232);

    await $("button[aria-label='Collapse sidebar']").click();
    const collapsed = await readShell();

    expect(collapsed.sidebarWidth).toBe(56);
    expect(collapsed.collapseLabel).toBe("Expand sidebar");

    await $("button[aria-label='Expand sidebar']").click();
    const expanded = await readShell();

    expect(expanded.sidebarWidth).toBe(232);
    expect(expanded.collapseLabel).toBe("Collapse sidebar");
  });
});
