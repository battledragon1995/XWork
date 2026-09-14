import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/notes";
import { NoteEditor } from "./note-editor";
import type { NotesOwner } from "./notes-provider";
import { NotesTestHost, note, noteMocks } from "./notes-test-fixture";

/** Isolate all persistence and project reads. */
vi.mock("@/lib/ipc/notes");
/** Isolate project lookup and invalidation. */
vi.mock("@/lib/ipc/projects");
/** Avoid layout-dependent CodeMirror DOM while keeping its real transaction state. */
vi.mock("./note-editor-adapter", async (original) => ({
  ...(await original<typeof import("./note-editor-adapter")>()),
  mountNoteEditor: vi.fn((_parent, state) => ({
    state,
    destroy: vi.fn(),
    focus: vi.fn(),
    scrollDOM: document.createElement("div"),
  })),
}));
/** Initialize isolated wrappers. */
beforeEach(() => {
  vi.clearAllMocks();
  noteMocks();
});
/** Release provider timers and DOM. */
afterEach(cleanup);
/** Preview toggles preserve the editor instance and title-only drafts focus the title. */
it("retains its editor across preview and focuses new titles", async () => {
  let owner!: NotesOwner;
  render(
    <NotesTestHost
      initial={null}
      capture={(value) => {
        owner = value;
      }}
    >
      <NoteEditor />
    </NotesTestHost>,
  );
  await waitFor(() => expect(screen.getByLabelText("Note title")).toHaveFocus());
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Local" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(owner.state.draft?.mode).toBe("preview");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Note title")).toHaveValue("Local");
  expect(screen.getByText("Add some content to save this note")).toBeVisible();
});
/** Archived records are read-only in both modes and expose exact Markdown for copying. */
it("renders archived raw text read-only with selectable copy recovery", async () => {
  vi.mocked(ipc.getNote).mockResolvedValue({ ...note, status: "archived" });
  render(
    <NotesTestHost initial={{ ...note, status: "archived" }}>
      <NoteEditor />
    </NotesTestHost>,
  );
  await screen.findByText("This note is archived. Read-only.");
  expect(screen.getByLabelText("Note title")).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
  expect(screen.getByLabelText("Copy Markdown")).toHaveValue(note.contentMarkdown);
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
});
