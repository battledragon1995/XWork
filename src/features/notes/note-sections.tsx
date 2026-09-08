import { Link } from "react-router";
import type { NotePinnedFilterDto } from "@/bindings/notes";
import { Button } from "@/components/ui/button";
import { useNotesQuery } from "./notes-provider";
/** Render one independently recoverable bounded server projection. */
function NoteSection({
  title,
  limit,
  pinnedFilter,
  projectId,
}: {
  title: string;
  limit: number;
  pinnedFilter: NotePinnedFilterDto;
  projectId?: string;
}) {
  const query = useNotesQuery({
    status: "active",
    query: null,
    projectFilter: projectId ? { kind: "project", projectId } : { kind: "all" },
    pinnedFilter,
    offset: 0,
    limit,
  });
  const suffix = projectId ? `&projectId=${encodeURIComponent(projectId)}` : "";
  return (
    <section aria-label={title} className="min-w-0 space-y-3" aria-busy={query.loading}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {query.loading && <p role="status">Loading notes…</p>}
      {query.error && <p role="alert">{query.error}</p>}
      {!query.loading && !query.error && !query.page?.items.length && <p>No notes yet</p>}
      <ul className="space-y-3">
        {query.page?.items.map(
          /** Preserve server ordering and stable row identity. */ (note) => (
            <li key={note.id}>
              <Link
                className="block rounded-lg border border-hairline p-4 focus-visible:ring-2 focus-visible:ring-ring"
                to={`/notes?noteId=${encodeURIComponent(note.id)}&view=active`}
              >
                <span className="block font-medium">{note.title || "Untitled note"}</span>
                <span className="block whitespace-pre-wrap break-words text-sm text-muted">
                  {note.snippet}
                </span>
              </Link>
            </li>
          ),
        )}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link to={`/notes?view=active${suffix}`}>All notes</Link>
        {projectId && <Link to={`/notes?new=1${suffix}`}>New note</Link>}
        <Button variant="outline" onClick={query.refresh}>
          Refresh
        </Button>
      </div>
    </section>
  );
}
/** Compose the two distinct Home caps without mixing pin groups. */
export function HomeNoteSections() {
  return (
    <div className="space-y-6">
      <Link to="/notes">Open Notes</Link>
      <NoteSection title="Pinned notes" limit={2} pinnedFilter="only" />
      <NoteSection title="Recent notes" limit={3} pinnedFilter="exclude" />
    </div>
  );
}
/** Project composition receives only the loaded public project identity. */
export function ProjectNotesSection({ projectId }: { projectId: string }) {
  return <NoteSection title="Linked notes" limit={5} pinnedFilter="any" projectId={projectId} />;
}
