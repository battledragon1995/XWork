import { expect, it } from "vitest";
import type { NotesError } from "@/bindings/notes";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { noteErrorCopy } from "./note-error-copy";
const codes: NotesError["code"][] = [
  "unauthorized_window",
  "invalid_note_id",
  "invalid_revision",
  "invalid_title",
  "empty_initial_content",
  "content_too_large",
  "invalid_search",
  "invalid_pagination",
  "invalid_filter",
  "invalid_project_id",
  "project_not_found",
  "note_not_found",
  "note_not_editable",
  "invalid_transition",
  "revision_conflict",
  "revision_exhausted",
  "trash_empty",
  "no_pending_trash_operation",
  "stale_trash_request",
  "trash_changed",
  "clock_failed",
  "persistence_failed",
];
/** Every generated tagged error receives safe English recovery copy. */
it.each(codes)("covers %s without rendering native payloads", (code) => {
  const copy = noteErrorCopy(new IpcCallError("note", { code, secret: "private-path" }));
  expect(copy.length).toBeGreaterThan(10);
  expect(copy).not.toContain("private-path");
});
/** Unknown failures cannot expose the raw rejection. */
it("redacts unknown transport errors", () => {
  expect(noteErrorCopy("secret-content")).not.toContain("secret-content");
});
