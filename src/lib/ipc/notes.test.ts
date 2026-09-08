import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import * as notes from "./notes";
import { IpcCallError } from "./ipc-error";
/** Replace native calls with an isolated envelope recorder. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Never register an actual window listener in tests. */
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
/** Reset only mocked transport state. */
beforeEach(() => vi.clearAllMocks());
/** Preserve null fields and decimal revisions larger than JS integers. */
it("forwards generated Notes envelopes", async () => {
  const input = {
    status: "active" as const,
    query: null,
    projectFilter: { kind: "all" as const },
    pinnedFilter: "any" as const,
    offset: 0,
    limit: 50,
  };
  await notes.listNotes(input);
  expect(invoke).toHaveBeenLastCalledWith("list_notes", { input });
  await notes.getNote("note");
  expect(invoke).toHaveBeenLastCalledWith("get_note", { noteId: "note" });
  const save = {
    noteId: "note",
    expectedRevision: "9007199254740993",
    title: null,
    contentMarkdown: "body",
  };
  await notes.autosaveNote(save);
  expect(invoke).toHaveBeenLastCalledWith("autosave_note", { input: save });
  await notes.createNote({ title: null, contentMarkdown: "body", projectId: null });
  expect(invoke).toHaveBeenLastCalledWith("create_note", {
    input: { title: null, contentMarkdown: "body", projectId: null },
  });
});
/** Check each lifecycle command rather than assuming naming conversions. */
it("forwards metadata, lifecycle and Trash request identities", async () => {
  const input = { noteId: "note", expectedRevision: "42" };
  for (const [command, fn] of [
    ["archive_note", notes.archiveNote],
    ["restore_archived_note", notes.restoreArchivedNote],
    ["move_note_to_trash", notes.moveNoteToTrash],
    ["restore_note_from_trash", notes.restoreNoteFromTrash],
    ["delete_note_permanently", notes.deleteNotePermanently],
  ] as const) {
    await fn(input);
    expect(invoke).toHaveBeenLastCalledWith(command, { input });
  }
  await notes.setNotePinned({ ...input, pinned: true });
  expect(invoke).toHaveBeenLastCalledWith("set_note_pinned", { input: { ...input, pinned: true } });
  await notes.setNoteProject({ ...input, projectId: null });
  expect(invoke).toHaveBeenLastCalledWith("set_note_project", {
    input: { ...input, projectId: null },
  });
  await notes.prepareEmptyNotesTrash();
  expect(invoke).toHaveBeenLastCalledWith("prepare_empty_notes_trash", undefined);
  await notes.confirmEmptyNotesTrash(7);
  expect(invoke).toHaveBeenLastCalledWith("confirm_empty_notes_trash", { requestId: 7 });
  await notes.cancelEmptyNotesTrash(7);
  expect(invoke).toHaveBeenLastCalledWith("cancel_empty_notes_trash", { requestId: 7 });
});
/** Normalize errors and expose only invalidation payloads. */
it("normalizes transport and unwraps the canonical event", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("sensitive path");
  await expect(notes.getNote("n")).rejects.toEqual(new IpcCallError("get_note", null));
  const handler = vi.fn();
  await notes.onNotesChanged(handler);
  expect(listen).toHaveBeenCalledWith("notes://changed", expect.any(Function));
  const callback = vi.mocked(listen).mock.calls[0]?.[1];
  const payload = { sequence: "1", kind: "reset" as const, noteId: null, revision: null };
  callback?.({ event: "notes://changed", id: 1, payload });
  expect(handler).toHaveBeenCalledWith(payload);
});
