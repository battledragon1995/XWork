import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/notes";
import { NoteHighlight, NotesRoute } from "./notes-route";
import { noteMocks, NotesTestHost } from "./notes-test-fixture";
/** Isolate the public backend. */
vi.mock("@/lib/ipc/notes");
/** Isolate project identity reads. */
vi.mock("@/lib/ipc/projects");
/** The route test exercises selection, not editor layout. */
vi.mock("./note-editor", () => ({ NoteEditor: () => <div>Editor host</div> }));
/** Reset every query response independently. */
beforeEach(() => {
  vi.clearAllMocks();
  noteMocks();
});
/** Dispose query timers and listeners. */
afterEach(cleanup);
/** Search/filter changes send the generated server filters. */
it("shows real empty state and sends search, pin and project filters", async () => {
  render(
    <MemoryRouter>
      <NotesTestHost>
        <NotesRoute />
      </NotesTestHost>
    </MemoryRouter>,
  );
  await screen.findByText("No notes yet");
  fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hello" } });
  fireEvent.click(screen.getByLabelText("Pinned only"));
  fireEvent.change(screen.getByLabelText("Project filter"), { target: { value: "unlinked" } });
  await waitFor(() =>
    expect(ipc.listNotes).toHaveBeenLastCalledWith({
      status: "active",
      query: "hello",
      projectFilter: { kind: "unlinked" },
      pinnedFilter: "only",
      offset: 0,
      limit: 50,
    }),
  );
  await screen.findByText("No matching notes");
});
/** Invalid route combinations must not read a target or create anything. */
it("rejects conflicting new and note parameters", async () => {
  render(
    <MemoryRouter initialEntries={["/notes?new=1&noteId=n"]}>
      <NotesTestHost>
        <NotesRoute />
      </NotesTestHost>
    </MemoryRouter>,
  );
  expect(await screen.findByText("This Notes link is invalid.")).toBeVisible();
  expect(ipc.getNote).not.toHaveBeenCalled();
  expect(ipc.createNote).not.toHaveBeenCalled();
});
/** Non-BMP characters use scalar highlight indices, not UTF-16 positions. */
it("highlights exact backend scalar ranges", () => {
  const { container } = render(
    <NoteHighlight text="a😀b" ranges={[{ startScalar: 1, endScalar: 2 }]} />,
  );
  expect(container.querySelector("mark")?.textContent).toBe("😀");
  expect(container.textContent).toBe("a😀b");
});
