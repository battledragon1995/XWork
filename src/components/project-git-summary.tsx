import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectGitSummaryDto } from "@/bindings/projects/projects";
import { getProjectGitSummary } from "@/lib/ipc/projects";

/** Share compact repository metadata between Home rows and Project cards. */
export function ProjectGitSummary({
  projectId,
  suspended = false,
  epoch = 0,
  readBoundary,
}: {
  projectId: string;
  suspended?: boolean;
  epoch?: number;
  readBoundary?(): { suspended: boolean; epoch: number };
}) {
  const [summary, setSummary] = useState<ProjectGitSummaryDto | null>(null);
  useEffect(() => {
    let retired = false;
    let sequence = 0;
    setSummary(null);
    /** Ignore responses across project replacement, maintenance, or unmount. */
    function current() {
      const live = readBoundary?.();
      return !retired && !suspended && (!live || (!live.suspended && live.epoch === epoch));
    }
    /** Refresh only this visible card's compact backend summary. */
    async function refresh() {
      if (!current()) return;
      const ticket = ++sequence;
      try {
        const value = await getProjectGitSummary(projectId);
        if (current() && ticket === sequence) setSummary(value ?? null);
      } catch {
        if (current() && ticket === sequence) setSummary(null);
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return /** Release foreground refresh and retire pending reads. */ () => {
      retired = true;
      window.removeEventListener("focus", refresh);
    };
  }, [projectId, suspended, epoch, readBoundary]);
  if (suspended || !summary || summary.projectId !== projectId) return null;
  if (summary.repositoryKind === "notRepository")
    return <span className="text-xs text-muted">No Git repository</span>;
  const head = summary.head;
  const branch = head?.kind === "detached" ? head.shortOid : head?.name;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <GitBranch aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate font-mono">{branch || "No commits"}</span>
      <span className="shrink-0">· {summary.changedCount} changed</span>
    </span>
  );
}
