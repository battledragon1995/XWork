import { useEffect, type ReactNode } from "react";
import { vi } from "vitest";
import type { NoteDto } from "@/bindings/notes";
import * as ipc from "@/lib/ipc/notes";
import * as projects from "@/lib/ipc/projects";
import { NotesProvider, type NotesOwner, useNotes } from "./notes-provider";
export const note: NoteDto = {
  id: "n",
  title: "A note",
  contentMarkdown: "# Markdown\n\nbody",
  projectId: null,
  isPinned: false,
  status: "active",
  trashedFrom: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  archivedAtMs: null,
  trashedAtMs: null,
  revision: "17",
};
/** Supply isolated public IPC defaults; this helper never touches native app data. */
export function noteMocks() {
  vi.mocked(ipc.onNotesChanged).mockResolvedValue(vi.fn());
  vi.mocked(projects.onProjectsChanged).mockResolvedValue(vi.fn());
  vi.mocked(projects.listProjects).mockResolvedValue([]);
  vi.mocked(ipc.listNotes).mockResolvedValue({
    items: [],
    offset: 0,
    totalMatches: 0,
    hasMore: false,
    counts: { active: 0, archived: 0, trash: 0 },
  });
  vi.mocked(ipc.getNote).mockResolvedValue(note);
  vi.mocked(ipc.createNote).mockResolvedValue(note);
  vi.mocked(ipc.autosaveNote).mockImplementation(async (input) => ({
    ...note,
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    revision: "18",
  }));
}
/** Capture the real retained owner for focused interleaving tests. */
function Probe({
  capture,
  initial,
}: {
  capture?(owner: NotesOwner): void;
  initial?: NoteDto | null;
}) {
  const { owner } = useNotes();
  useEffect(() => {
    if (initial !== undefined) owner.install(initial);
    capture?.(owner);
  }, [capture, initial, owner]);
  return null;
}
/** Mount one production provider around isolated UI consumers. */
export function NotesTestHost({
  children,
  capture,
  initial,
}: {
  children: ReactNode;
  capture?(owner: NotesOwner): void;
  initial?: NoteDto | null;
}) {
  return (
    <NotesProvider>
      <Probe capture={capture} initial={initial} />
      {children}
    </NotesProvider>
  );
}
