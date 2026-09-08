import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/notes";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { EmptyTrash, NoteActions } from "./note-actions";
import { note, noteMocks, NotesTestHost } from "./notes-test-fixture";
/** Isolate Notes commands. */
vi.mock("@/lib/ipc/notes");
/** Isolate project choices. */
vi.mock("@/lib/ipc/projects");
/** Seed safe generated snapshots. */
beforeEach(() => {
  vi.clearAllMocks();
  noteMocks();
});
/** Release dialogs and listeners. */
afterEach(cleanup);
/** Trash restoration uses the specific command and opaque revision. */
it("restores Trash through its previous-lifecycle command", async () => {
  vi.mocked(ipc.getNote).mockResolvedValue({ ...note, status: "trash", trashedFrom: "archived" });
  vi.mocked(ipc.restoreNoteFromTrash).mockResolvedValue({ ...note, status: "archived" });
  render(
    <NotesTestHost initial={{ ...note, status: "trash", trashedFrom: "archived" }}>
      <NoteActions />
    </NotesTestHost>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(ipc.restoreNoteFromTrash).toHaveBeenCalledWith({ noteId: "n", expectedRevision: "17" }),
  );
  expect(ipc.restoreArchivedNote).not.toHaveBeenCalled();
});
/** A changed Trash impact requires another visible user confirmation. */
it("replaces changed impact without replaying confirmation", async () => {
  const impact = {
    requestId: 1,
    noteCount: 1,
    notes: [{ noteId: "n", displayTitle: "First" }],
    hasMore: false,
  };
  vi.mocked(ipc.prepareEmptyNotesTrash).mockResolvedValue(impact);
  vi.mocked(ipc.confirmEmptyNotesTrash)
    .mockRejectedValueOnce(
      new IpcCallError("confirm_empty_notes_trash", {
        code: "trash_changed",
        impact: { ...impact, requestId: 2, noteCount: 2 },
      }),
    )
    .mockResolvedValueOnce({ deletedCount: 2 });
  render(
    <NotesTestHost>
      <EmptyTrash disabled={false} />
    </NotesTestHost>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete all notes" }));
  await screen.findByText("Permanently delete 2 notes. This cannot be undone.");
  expect(ipc.confirmEmptyNotesTrash).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete all notes" }));
  await waitFor(() => expect(ipc.confirmEmptyNotesTrash).toHaveBeenLastCalledWith(2));
});
/** Explicit row deletion has no extra confirmation layer or duplicate dispatch. */
it("deletes one selected Trash record once", async () => {
  vi.mocked(ipc.getNote).mockResolvedValue({ ...note, status: "trash" });
  vi.mocked(ipc.deleteNotePermanently).mockResolvedValue({ noteId: "n" });
  render(
    <NotesTestHost initial={{ ...note, status: "trash" }}>
      <NoteActions />
    </NotesTestHost>,
  );
  const button = await screen.findByRole("button", { name: "Delete permanently" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(ipc.deleteNotePermanently).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});
