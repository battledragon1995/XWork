import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { RecentFileDto } from "@/bindings/files/files";
import { listRecentFiles } from "@/lib/ipc/files";
import type { FileExplorerProps } from "./file-explorer";

/** Present existing recent-file facts in the project overview without creating a session. */
export function RecentProjectFiles({
  projectId,
  boundary,
  readBoundary,
}: Pick<FileExplorerProps, "projectId" | "boundary" | "readBoundary">) {
  const [files, setFiles] = useState<RecentFileDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const epoch = boundary?.epoch ?? 0;
  const suspended = boundary?.suspended ?? false;
  useEffect(() => {
    let retired = false;
    let sequence = 0;
    setFiles(null);
    setFailed(false);
    /** Guard both navigation lifetime and the synchronous maintenance boundary. */
    function current() {
      const live = readBoundary?.();
      return !retired && !suspended && (!live || (!live.suspended && live.epoch === epoch));
    }
    /** Refresh the bounded projection when this overview returns to the foreground. */
    async function refresh() {
      if (!current()) return;
      const ticket = ++sequence;
      try {
        const rows = await listRecentFiles(projectId, 5);
        if (current() && ticket === sequence) {
          setFiles(rows);
          setFailed(false);
        }
      } catch {
        if (current() && ticket === sequence) setFailed(true);
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return /** Retire reads across a route or maintenance change. */ () => {
      retired = true;
      window.removeEventListener("focus", refresh);
    };
  }, [projectId, epoch, suspended, readBoundary]);
  return (
    <section aria-label="Recent files" className="min-w-0 space-y-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted">Recent files</h2>
      {failed ? (
        <p role="status" className="text-xs text-muted">
          Recent files are unavailable.
        </p>
      ) : files === null ? (
        <p className="text-xs text-muted">Loading recent files…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted">Files opened in this project will appear here.</p>
      ) : (
        <ul className="divide-y divide-hairline-soft">
          {files.map(
            /** Keep backend order and identify entries by their project-relative path. */ (
              file,
            ) => (
              <li
                key={file.relativePath}
                className="flex min-w-0 items-center gap-2 py-2 text-[13px]"
                title={file.relativePath}
              >
                <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">
                  {file.name}
                  <span className="ml-2 text-xs text-muted">{file.parentPath}</span>
                </span>
                {file.availability !== "available" && (
                  <span className="text-xs text-muted">Unavailable</span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
