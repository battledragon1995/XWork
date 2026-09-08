import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoteDto } from "@/bindings/notes";
import * as ipc from "@/lib/ipc/notes";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { NotesOwner } from "./notes-provider";
/** Isolate every operation from actual persistence. */
vi.mock("@/lib/ipc/notes", () => ({
  createNote: vi.fn(),
  autosaveNote: vi.fn(),
  getNote: vi.fn(),
}));
const base: NoteDto = {
  id: "note",
  title: null,
  contentMarkdown: "body",
  projectId: null,
  isPinned: false,
  status: "active",
  trashedFrom: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  archivedAtMs: null,
  trashedAtMs: null,
  revision: "9007199254740993",
};
/** Control debounce without sleeping or accessing user data. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(ipc.getNote).mockResolvedValue(base);
});
/** Dispose all timers between isolated owners. */
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
/** Build independently controlled responses for race assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Never persist a title-only or whitespace initial draft. */
it("admits only valid initial content after exactly 500 ms", async () => {
  const owner = new NotesOwner();
  owner.install(null);
  owner.edit({ title: "Title", contentMarkdown: "  " });
  await vi.advanceTimersByTimeAsync(500);
  expect(ipc.createNote).not.toHaveBeenCalled();
  vi.mocked(ipc.createNote).mockResolvedValue(base);
  owner.edit({ contentMarkdown: "body" });
  await vi.advanceTimersByTimeAsync(499);
  expect(ipc.createNote).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  expect(owner.state.draft?.phase).toBe("saved");
});
/** An older acknowledgement must not replace text typed during its flight. */
it("creates once and serializes the next generation against its acknowledged revision", async () => {
  const create = deferred<NoteDto>();
  const save = deferred<NoteDto>();
  vi.mocked(ipc.createNote).mockReturnValue(create.promise);
  vi.mocked(ipc.autosaveNote).mockReturnValue(save.promise);
  const owner = new NotesOwner();
  owner.install(null);
  owner.edit({ contentMarkdown: "body" });
  const flush = owner.flush();
  owner.edit({ contentMarkdown: "newer" });
  create.resolve(base);
  await vi.advanceTimersByTimeAsync(0);
  expect(owner.state.draft?.contentMarkdown).toBe("newer");
  expect(ipc.autosaveNote).toHaveBeenCalledWith({
    noteId: "note",
    expectedRevision: base.revision,
    title: null,
    contentMarkdown: "newer",
  });
  expect(owner.state.draft?.phase).toBe("saving");
  save.resolve({ ...base, contentMarkdown: "newer", revision: "9007199254740994" });
  await flush;
  expect(owner.state.draft?.phase).toBe("saved");
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
});
/** Unknown creation is never silently replayed by timers, barriers or retries. */
it("retains an unknown create until explicit duplication intent", async () => {
  vi.mocked(ipc.createNote).mockRejectedValueOnce(new IpcCallError("create_note", null));
  const owner = new NotesOwner();
  owner.install(null);
  owner.edit({ contentMarkdown: "body" });
  await expect(owner.flush()).rejects.toThrow();
  owner.edit({ title: "still local" });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(owner.settleBeforeDataChange()).rejects.toThrow();
  owner.releaseDataChangeBarrier();
  await owner.retry();
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  expect(owner.state.draft?.phase).toBe("uncertain");
  vi.mocked(ipc.createNote).mockResolvedValue(base);
  await owner.createAnother();
  expect(ipc.createNote).toHaveBeenCalledTimes(2);
});
/** A maintenance barrier closes admission before waiting, then reset retires the draft. */
it("blocks concurrent input and prevents reset/import draft replay", async () => {
  const save = deferred<NoteDto>();
  vi.mocked(ipc.autosaveNote).mockReturnValue(save.promise);
  const owner = new NotesOwner();
  owner.install(base);
  owner.edit({ contentMarkdown: "pending" });
  const barrier = owner.settleBeforeDataChange();
  expect(owner.state.blocked).toBe(true);
  owner.edit({ contentMarkdown: "forbidden" });
  expect(owner.state.draft?.contentMarkdown).toBe("pending");
  save.resolve({ ...base, contentMarkdown: "pending", revision: "next" });
  await barrier;
  owner.clearAfterReset();
  owner.releaseDataChangeBarrier();
  await vi.advanceTimersByTimeAsync(1000);
  expect(owner.state.draft).toBeNull();
  expect(ipc.autosaveNote).toHaveBeenCalledTimes(1);
});
/** Conflict recovery requires explicit intent and uses the current opaque revision. */
it("keeps conflicts local and overwrites only after explicit resolution", async () => {
  const current = { ...base, contentMarkdown: "external", revision: "9007199254740997" };
  vi.mocked(ipc.autosaveNote)
    .mockRejectedValueOnce(
      new IpcCallError("autosave_note", { code: "revision_conflict", current }),
    )
    .mockResolvedValueOnce({ ...current, contentMarkdown: "local" });
  const owner = new NotesOwner();
  owner.install(base);
  owner.edit({ contentMarkdown: "local" });
  await expect(owner.flush()).rejects.toThrow();
  await expect(owner.select("other")).rejects.toThrow();
  expect(owner.state.draft?.contentMarkdown).toBe("local");
  await owner.resolve(true);
  expect(ipc.autosaveNote).toHaveBeenLastCalledWith({
    noteId: base.id,
    expectedRevision: current.revision,
    title: null,
    contentMarkdown: "local",
  });
});
/** Composition never begins autosave before committed input. */
it("defers IME and rejects invalid initial maintenance", async () => {
  const owner = new NotesOwner();
  owner.install(null);
  owner.composition(true);
  owner.edit({ contentMarkdown: "Việt" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(ipc.createNote).not.toHaveBeenCalled();
  vi.mocked(ipc.createNote).mockResolvedValue({ ...base, contentMarkdown: "Việt" });
  owner.composition(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  owner.install(null);
  owner.edit({ title: "Only title" });
  await expect(owner.settleBeforeDataChange()).rejects.toThrow("Initial draft is empty");
});
/** Metadata receives the revision returned by the preceding text save. */
it("flushes text before a lifecycle command and blocks duplicate actions", async () => {
  const save = deferred<NoteDto>();
  vi.mocked(ipc.autosaveNote).mockReturnValue(save.promise);
  const owner = new NotesOwner();
  owner.install(base);
  owner.edit({ title: "latest" });
  const operation = vi.fn().mockResolvedValue({ ...base, status: "archived" });
  const action = owner.mutate(operation);
  await owner.mutate(operation);
  expect(operation).not.toHaveBeenCalled();
  save.resolve({ ...base, title: "latest", revision: "new-revision" });
  await action;
  expect(operation).toHaveBeenCalledTimes(1);
  expect(operation.mock.calls[0]?.[0].revision).toBe("new-revision");
});

/** Maintenance waits for an already admitted metadata mutation before releasing producers. */
it("settles an admitted lifecycle flight before maintenance", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  const pending = deferred<NoteDto>();
  const action = owner.mutate(() => pending.promise);
  await vi.advanceTimersByTimeAsync(0);
  let settled = false;
  const barrier = owner.settleBeforeDataChange().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  pending.resolve({ ...base, status: "archived" });
  await action;
  await barrier;
  expect(owner.state.blocked).toBe(true);
});
/** Imported revisions are authoritative and old autosave text is never resubmitted. */
it("refreshes imported data without replaying its prior clean draft", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  await owner.settleBeforeDataChange();
  vi.mocked(ipc.getNote).mockResolvedValue({ ...base, contentMarkdown: "imported", revision: "1" });
  await owner.refreshAfterDataChange();
  owner.releaseDataChangeBarrier();
  await vi.advanceTimersByTimeAsync(1000);
  expect(owner.state.draft?.contentMarkdown).toBe("imported");
  expect(ipc.autosaveNote).not.toHaveBeenCalled();
});
/** A second reset retires an older import read before that response can reinstall a draft. */
it("rejects a stale maintenance detail response", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.getNote).mockReturnValueOnce(pending.promise);
  const refresh = owner.refreshAfterDataChange();
  owner.clearAfterReset();
  pending.resolve(base);
  await refresh;
  expect(owner.state.draft).toBeNull();
});

/** Input arriving during a slow detail read cannot be silently replaced. */
it("retains text typed during pending selection", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.getNote).mockReturnValueOnce(pending.promise);
  const selecting = owner.select("other");
  await vi.advanceTimersByTimeAsync(0);
  owner.edit({ contentMarkdown: "late local" });
  pending.resolve({ ...base, id: "other" });
  await expect(selecting).rejects.toThrow("New edits arrived");
  expect(owner.state.draft?.contentMarkdown).toBe("late local");
});
/** Failed reconciliation retains the identity needed by a read-only retry. */
it("retries a failed imported detail read without replaying writes", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  vi.mocked(ipc.getNote)
    .mockRejectedValueOnce(new IpcCallError("get_note", null))
    .mockResolvedValueOnce({ ...base, contentMarkdown: "imported" });
  await expect(owner.refreshAfterDataChange()).rejects.toThrow();
  await owner.refreshAfterDataChange();
  expect(owner.state.draft?.contentMarkdown).toBe("imported");
  expect(ipc.autosaveNote).not.toHaveBeenCalled();
});
/** The manual Home owner is a distinct public capability of the retained Notes lifetime. */
it("exposes manual quick actions", () => {
  const owner = new NotesOwner();
  expect(owner.saveQuickNote).toBeTypeOf("function");
});
/** Manual edits cannot overwrite or autosave the Notes editor draft. */
it("keeps quick input independent of autosave and query invalidation", async () => {
  const owner = new NotesOwner();
  owner.install(base);
  const retained = owner.state.draft;
  owner.editQuickNote({ contentMarkdown: "manual" });
  owner.invalidate();
  await vi.advanceTimersByTimeAsync(1000);
  expect(ipc.createNote).not.toHaveBeenCalled();
  expect(owner.state.draft?.contentMarkdown).toBe(retained?.contentMarkdown);
  expect(owner.state.quickNote.contentMarkdown).toBe("manual");
});
/** Duplicate saves and maintenance share one admitted manual flight. */
it("drains the accepted quick flight through a same-tick barrier", async () => {
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.createNote).mockReturnValue(pending.promise);
  const owner = new NotesOwner();
  owner.editQuickNote({ title: " raw ", contentMarkdown: "\nbody\n", projectId: "p" });
  const save = owner.saveQuickNote();
  const duplicate = owner.saveQuickNote();
  const settle = owner.settleBeforeDataChange();
  owner.editQuickNote({ contentMarkdown: "lost" });
  owner.cancelQuickNote();
  expect(owner.state.blocked).toBe(true);
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  expect(ipc.createNote).toHaveBeenCalledWith({
    title: " raw ",
    contentMarkdown: "\nbody\n",
    projectId: "p",
  });
  pending.resolve(base);
  await Promise.all([save, duplicate, settle]);
  expect(owner.state.quickNote.savedNote).toEqual(base);
  expect(owner.state.quickNote.projectId).toBeNull();
  expect(owner.state.blocked).toBe(true);
});
/** Every retained manual input must be explicitly resolved before maintenance. */
it.each([{ title: "title" }, { contentMarkdown: " \n " }, { projectId: "p" }])(
  "blocks maintenance for %j without saving",
  async (patch) => {
    const owner = new NotesOwner();
    owner.editQuickNote(patch);
    await expect(owner.settleBeforeDataChange()).rejects.toThrow("Quick Note on Home");
    await owner.saveQuickNote();
    expect(ipc.createNote).not.toHaveBeenCalled();
    owner.cancelQuickNote();
    expect(owner.state.quickNote.phase).not.toBe("empty");
    owner.releaseDataChangeBarrier();
    owner.cancelQuickNote();
    await owner.settleBeforeDataChange();
  },
);
/** Unknown creation stays copyable and cannot be retried by ordinary owner activity. */
it("preserves uncertain quick intent until explicit Cancel", async () => {
  vi.mocked(ipc.createNote).mockRejectedValue(new IpcCallError("create_note", null));
  const owner = new NotesOwner();
  owner.editQuickNote({ contentMarkdown: "unknown" });
  await owner.saveQuickNote();
  const epoch = owner.state.epoch;
  owner.editQuickNote({ contentMarkdown: "new" });
  owner.invalidate();
  await owner.flush();
  await owner.saveQuickNote();
  await vi.advanceTimersByTimeAsync(1000);
  expect(owner.state.quickNote.contentMarkdown).toBe("unknown");
  expect(owner.state.quickNote.phase).toBe("uncertain");
  expect(epoch).toBeGreaterThan(0);
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  await expect(owner.settleBeforeDataChange()).rejects.toThrow("Quick Note");
  owner.releaseDataChangeBarrier();
  owner.cancelQuickNote();
  expect(owner.state.quickNote.phase).toBe("empty");
});
/** Failed admitted creates release only through the public maintenance bridge protocol. */
it("rejects the barrier after a known failed quick flight and allows explicit recovery", async () => {
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.createNote).mockReturnValue(pending.promise);
  const owner = new NotesOwner();
  owner.editQuickNote({ contentMarkdown: "body" });
  const save = owner.saveQuickNote();
  const settled = expect(owner.settleBeforeDataChange()).rejects.toThrow("Quick Note");
  pending.reject(new IpcCallError("create_note", { code: "persistence_failed" }));
  await save;
  await settled;
  expect(owner.state.blocked).toBe(true);
  expect(owner.state.quickNote.phase).toBe("error");
  owner.releaseDataChangeBarrier();
  vi.mocked(ipc.createNote).mockResolvedValue(base);
  await owner.saveQuickNote();
  expect(owner.state.quickNote.phase).toBe("saved");
});
/** Retired lifetimes cannot republish success or failure after data replacement. */
it.each(["reset", "refresh"])("retires quick responses across %s", async (operation) => {
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.createNote).mockReturnValue(pending.promise);
  const owner = new NotesOwner();
  owner.editQuickNote({ contentMarkdown: "old" });
  const save = owner.saveQuickNote();
  if (operation === "reset") owner.clearAfterReset();
  else await owner.refreshAfterDataChange();
  pending.resolve(base);
  await save;
  expect(owner.state.quickNote.phase).toBe("empty");
  expect(owner.state.quickNote.savedNote).toBeNull();
});
/** Independent editor generations still autosave while the manual capture remains unsubmitted. */
it("autosaves the Notes editor without submitting its separate quick draft", async () => {
  vi.mocked(ipc.autosaveNote).mockResolvedValue({ ...base, contentMarkdown: "editor change" });
  const owner = new NotesOwner();
  owner.install(base);
  owner.edit({ contentMarkdown: "editor change" });
  owner.editQuickNote({ contentMarkdown: "manual capture" });
  await vi.advanceTimersByTimeAsync(500);
  expect(ipc.autosaveNote).toHaveBeenCalledTimes(1);
  expect(ipc.createNote).not.toHaveBeenCalled();
  expect(owner.state.quickNote.contentMarkdown).toBe("manual capture");
});
