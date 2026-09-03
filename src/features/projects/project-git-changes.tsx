import type {
  GitFileChangeKindDto,
  GitHeadDto,
  ProjectGitStatusDto,
} from "@/bindings/projects/projects";

/** Accessible letter and full name for each generated Git change kind. */
const CHANGE_BADGES: Record<GitFileChangeKindDto, { letter: string; name: string }> = {
  added: { letter: "A", name: "Added" },
  modified: { letter: "M", name: "Modified" },
  deleted: { letter: "D", name: "Deleted" },
  renamed: { letter: "R", name: "Renamed" },
  copied: { letter: "C", name: "Copied" },
  typeChanged: { letter: "T", name: "Type changed" },
  untracked: { letter: "??", name: "Untracked" },
  conflicted: { letter: "U", name: "Conflicted" },
};

/** Convert a worktree head into the text used by the changes-block label. */
function gitHeadLabel(head: GitHeadDto | null): string {
  if (head === null) {
    return "unknown";
  }
  return head.kind === "detached" ? head.shortOid : head.name;
}

/** Render every worktree change exactly as returned by the read-only backend snapshot. */
export function ProjectGitChanges(props: { snapshot: ProjectGitStatusDto }) {
  const { snapshot } = props;
  if (snapshot.summary.repositoryKind !== "worktree") {
    return null;
  }

  return (
    <section aria-labelledby="project-git-changes-heading" className="min-w-0">
      <h2
        id="project-git-changes-heading"
        className="mb-2 text-[13px] font-medium text-body-strong"
      >
        Changes on {gitHeadLabel(snapshot.summary.head)} ({snapshot.summary.changedCount})
      </h2>

      {snapshot.changes.length === 0 ? (
        <p className="rounded-md border border-hairline bg-canvas px-3.5 py-3 text-[13px] text-muted">
          Working tree is clean.
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-canvas font-mono text-xs">
          {snapshot.changes.map((change) => {
            const badge = CHANGE_BADGES[change.change];
            const path =
              change.previousPath === null
                ? change.path
                : `${change.previousPath} → ${change.path}`;

            return (
              <li
                key={`${change.change}:${change.previousPath ?? ""}:${change.path}`}
                className="flex min-w-0 items-center gap-3 px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex w-6 shrink-0 justify-center rounded-sm bg-surface-card px-1 py-0.5 font-semibold text-body-strong"
                >
                  {badge.letter}
                </span>
                <span className="sr-only">{badge.name}: </span>
                <span className="min-w-0 break-all text-body">{path}</span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-2 text-xs text-muted-soft">
        Read-only. Commit, checkout and push happen in your terminal.
      </p>
    </section>
  );
}
