import { Folder, Pin } from "lucide-react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ProjectActionsMenu } from "./project-actions-menu";
import { unavailableReasonMessage } from "./project-error-copy";

/** Everything one card renders, plus the intents it reports upwards. */
export interface ProjectCardProps {
  project: ProjectDto;
  isBusy: boolean;
  registerTrigger(projectId: string, element: HTMLButtonElement | null): void;
  onOpen(): void;
  onRename(): void;
  onTogglePinned(): void;
  onOpenFolder(): void;
  onLocateFolder(): void;
  onRemove(): void;
}

/**
 * Render one registered project. The card shows only what `BE-003` owns — name, path, pin
 * state and freshly measured availability — so no branch, Git status, changed-file count or
 * session line exists here yet; those arrive with their own capabilities.
 */
export function ProjectCard(props: ProjectCardProps) {
  const { project, isBusy, registerTrigger } = props;
  const availability = project.availability;
  const isUnavailable = availability.status === "unavailable";

  return (
    <article
      className={cn(
        "flex min-h-[150px] flex-col gap-2.5 rounded-lg border border-hairline px-4 py-3.5",
        isUnavailable ? "bg-surface-soft" : "bg-canvas",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Folder
          aria-hidden="true"
          className={cn("size-4 shrink-0", isUnavailable ? "text-warn-ink" : "text-muted")}
        />
        <h3
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] font-medium",
            isUnavailable ? "text-muted" : "text-ink",
          )}
        >
          {project.displayName}
        </h3>
        {project.isPinned && (
          <span className="inline-flex shrink-0 text-muted-soft">
            <Pin aria-hidden="true" className="size-3.5" />
            {/* A non-interactive glyph carries hidden text rather than a tooltip, so the pin
                state is announced without adding a control nobody can activate. */}
            <span className="sr-only">Pinned</span>
          </span>
        )}
      </div>

      <p className="truncate font-mono text-xs text-muted" title={project.rootPath}>
        {project.rootPath}
      </p>

      {isUnavailable && (
        <p className="text-xs text-warn-ink">{unavailableReasonMessage(availability.reason)}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        {isUnavailable ? (
          <span className="rounded-sm bg-warn-surface px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
            Unavailable
          </span>
        ) : (
          <span />
        )}

        <span className="flex shrink-0 items-center gap-1">
          {isUnavailable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isBusy}
              className="border border-hairline"
              onClick={props.onLocateFolder}
            >
              Locate folder…
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isBusy}
              className="border border-hairline"
              onClick={props.onOpen}
            >
              Open
            </Button>
          )}

          <ProjectActionsMenu
            project={project}
            isBusy={isBusy}
            triggerRef={(element) => registerTrigger(project.id, element)}
            onRename={props.onRename}
            onTogglePinned={props.onTogglePinned}
            onOpenFolder={props.onOpenFolder}
            onLocateFolder={props.onLocateFolder}
            onRemove={props.onRemove}
          />
        </span>
      </div>
    </article>
  );
}
