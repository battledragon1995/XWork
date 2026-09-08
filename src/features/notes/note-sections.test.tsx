import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/notes";
import { HomeNoteSections, ProjectNotesSection } from "./note-sections";
import { noteMocks, NotesTestHost } from "./notes-test-fixture";
/** Isolate Notes reads. */
vi.mock("@/lib/ipc/notes");
/** Isolate event registration. */
vi.mock("@/lib/ipc/projects");
/** Reset projection responses. */
beforeEach(() => {
  vi.clearAllMocks();
  noteMocks();
});
/** Dispose all mounted query owners. */
afterEach(cleanup);
/** Home uses independent pinned and recent-unpinned backend caps. */
it("requests exact Home projections", async () => {
  render(
    <MemoryRouter>
      <NotesTestHost>
        <HomeNoteSections />
      </NotesTestHost>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(ipc.listNotes).toHaveBeenCalledWith({
      status: "active",
      query: null,
      projectFilter: { kind: "all" },
      pinnedFilter: "only",
      offset: 0,
      limit: 2,
    }),
  );
  expect(ipc.listNotes).toHaveBeenCalledWith({
    status: "active",
    query: null,
    projectFilter: { kind: "all" },
    pinnedFilter: "exclude",
    offset: 0,
    limit: 3,
  });
  expect(screen.getByRole("link", { name: "Open Notes" })).toHaveAttribute("href", "/notes");
});
/** Project entry preserves the exact verified identity in both query and draft link. */
it("requests five linked notes and preselects New note project", async () => {
  render(
    <MemoryRouter>
      <NotesTestHost>
        <ProjectNotesSection projectId="project-id" />
      </NotesTestHost>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(ipc.listNotes).toHaveBeenCalledWith({
      status: "active",
      query: null,
      projectFilter: { kind: "project", projectId: "project-id" },
      pinnedFilter: "any",
      offset: 0,
      limit: 5,
    }),
  );
  expect(screen.getByRole("link", { name: "New note" })).toHaveAttribute(
    "href",
    "/notes?new=1&projectId=project-id",
  );
});
