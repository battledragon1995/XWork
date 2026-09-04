// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatusDto } from "@/bindings/sessions/sessions";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/animate-ui/components/radix/sidebar";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { resetSessionsStore, useSessionsStore } from "./sessions-store";
import {
  createSessionSummary,
  FIXTURE_OTHER_PROJECT_ID,
  FIXTURE_PROJECT_ID,
} from "./sessions-test-fixture";
import { SidebarSessionRows } from "./sidebar-session-rows";

// Replace the whole Sessions boundary so no case reaches Tauri.
vi.mock("@/lib/ipc/sessions", () => ({
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
}));

const listSessionsMock = vi.mocked(sessionsIpc.listSessions);
const onRuntimeChangedMock = vi.mocked(sessionsIpc.onSessionsRuntimeChanged);

/** Report the current router path so a navigation can be asserted without a real window. */
function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

/**
 * Render the rows inside the providers they need. The real `Sidebar` is part of that: its
 * hover highlight is a context every sidebar entry reads.
 */
function renderRows(projectId = FIXTURE_PROJECT_ID, path = "/projects/project-alpha") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarSessionRows projectId={projectId} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionsStore();
  listSessionsMock.mockResolvedValue([]);
  onRuntimeChangedMock.mockResolvedValue(() => {});
});

afterEach(() => {
  cleanup();
  resetSessionsStore();
});

describe("SidebarSessionRows presentation", () => {
  // Verify every one of the six statuses is readable as text, not only as a coloured dot.
  it.each<[SessionStatusDto, string]>([
    ["noToolYet", "No tool chosen"],
    ["running", "Running"],
    ["unseenOutput", "New output"],
    ["needsAttention", "Needs attention"],
    ["finished", "Finished"],
    ["exitedWithError", "Exited with an error"],
  ])("announces %s as hidden text", async (status, label) => {
    listSessionsMock.mockResolvedValue([createSessionSummary({ status })]);

    renderRows();

    expect(await screen.findByText(label)).toHaveClass("sr-only");
  });

  // Verify a long name is clipped to one line while the full value stays available.
  it("offers the full name as a title", async () => {
    const name = "A session name that is far too long for one sidebar row";
    listSessionsMock.mockResolvedValue([createSessionSummary({ name })]);

    renderRows();

    const row = await screen.findByRole("link", { name: new RegExp(name) });
    expect(row.querySelector("span[title]")).toHaveAttribute("title", name);
  });

  // Verify the rows follow the exact order of the backend group.
  it("renders the rows in backend order", async () => {
    listSessionsMock.mockResolvedValue([
      createSessionSummary({ id: "s1", name: "First" }),
      createSessionSummary({ id: "s2", name: "Second" }),
    ]);

    renderRows();
    await screen.findByRole("link", { name: /First/ });

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/sessions/s1",
      "/sessions/s2",
    ]);
  });

  // Verify only sessions of the requested project are rendered under it.
  it("renders only its own project's sessions", async () => {
    listSessionsMock.mockResolvedValue([
      createSessionSummary({ id: "s1", name: "Alpha work" }),
      createSessionSummary({
        id: "s2",
        projectId: FIXTURE_OTHER_PROJECT_ID,
        name: "Beta work",
      }),
    ]);

    renderRows();
    await screen.findByRole("link", { name: /Alpha work/ });

    expect(screen.queryByRole("link", { name: /Beta work/ })).not.toBeInTheDocument();
  });

  // Verify the open session is the only row marked as the current page.
  it("marks exactly the open session as the current page", async () => {
    listSessionsMock.mockResolvedValue([
      createSessionSummary({ id: "s1", name: "First" }),
      createSessionSummary({ id: "s2", name: "Second" }),
    ]);

    renderRows(FIXTURE_PROJECT_ID, "/sessions/s2");
    const open = await screen.findByRole("link", { name: /Second/ });

    expect(open).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /First/ })).not.toHaveAttribute("aria-current");
  });
});

describe("SidebarSessionRows states", () => {
  // Verify an empty group adds no row at all, so no false session appears.
  it("renders no row for an empty group", async () => {
    listSessionsMock.mockResolvedValue([]);

    renderRows();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load sessions.")).not.toBeInTheDocument();
  });

  // Verify a failed read stays brief and offers exactly one more attempt.
  it("offers Try again after a failed read", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );

    renderRows();

    expect(await screen.findByText("Couldn't load sessions.")).toBeInTheDocument();
    expect(screen.queryByText(/projectLookupFailed/)).not.toBeInTheDocument();

    listSessionsMock.mockResolvedValue([createSessionSummary({ name: "Recovered" })]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: /Recovered/ })).toBeInTheDocument();
  });

  // Verify retained rows keep showing after a later failure, so data is never hidden by it.
  it("keeps its rows when a later read fails", async () => {
    listSessionsMock.mockResolvedValue([createSessionSummary({ name: "Kept" })]);
    renderRows();
    await screen.findByRole("link", { name: /Kept/ });

    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );
    useSessionsStore.getState().refresh();

    await vi.waitFor(() => expect(useSessionsStore.getState().failure).not.toBeNull());
    expect(screen.getByRole("link", { name: /Kept/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load sessions.")).not.toBeInTheDocument();
  });
});

describe("SidebarSessionRows navigation and resources", () => {
  // Verify a row opens its own session and calls no command of its own.
  it("navigates to the session without calling a command", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([createSessionSummary({ id: "s9", name: "Target" })]);

    renderRows();
    await user.click(await screen.findByRole("link", { name: /Target/ }));

    expect(screen.getByTestId("path")).toHaveTextContent("/sessions/s9");
    expect(listSessionsMock).toHaveBeenCalledOnce();
  });

  // Verify mounting acquires the shared store and unmounting releases it, which is what keeps
  // an icon-mode sidebar from leaking a listener.
  it("acquires and releases the shared store", async () => {
    const { unmount } = renderRows();

    await vi.waitFor(() => expect(useSessionsStore.getState().consumerCount).toBe(1));

    unmount();

    expect(useSessionsStore.getState().consumerCount).toBe(0);
  });

  // Verify two mounted groups still share one query and one subscription.
  it("shares one query between two mounted groups", async () => {
    renderRows(FIXTURE_PROJECT_ID);
    renderRows(FIXTURE_OTHER_PROJECT_ID);

    await vi.waitFor(() => expect(useSessionsStore.getState().consumerCount).toBe(2));
    expect(listSessionsMock).toHaveBeenCalledOnce();
    expect(onRuntimeChangedMock).toHaveBeenCalledOnce();
  });
});
