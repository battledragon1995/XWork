import { Check, Clipboard, FolderOpen, GitBranch, Pin, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectDto, ProjectGitSummaryDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectActionsMenu } from "./project-actions-menu";
import { unavailableReasonMessage } from "./project-error-copy";

/** Git line phase needed by the presentational header. */
export type ProjectOverviewGitPhase = "idle" | "loading" | "ready" | "failed";

/** Intent-only props for the project overview header. */
export interface ProjectOverviewHeaderProps {
  project: ProjectDto;
  gitSummary: ProjectGitSummaryDto | null;
  gitPhase: ProjectOverviewGitPhase;
  isActionsBusy: boolean;
  onOpenRename(): void;
  onTogglePinned(): void;
  onOpenFolder(): void;
  onLocateFolder(): void;
  onRequestRemove(): void;
}

/** Format a calendar date in the English day-month order used by the overview copy. */
function formatCalendarDate(timestampMs: number, includeYear: boolean): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).formatToParts(new Date(timestampMs));
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value;
  return year === undefined ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/** Format the date on which a project was registered. */
export function formatAddedAt(addedAtMs: number, nowMs: number): string {
  const added = new Date(addedAtMs);
  const now = new Date(nowMs);
  return `added ${formatCalendarDate(addedAtMs, added.getFullYear() !== now.getFullYear())}`;
}

/** Format the most recent explicit open using the FE-005 relative-time boundaries. */
export function formatOpenedAt(lastOpenedAtMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - lastOpenedAtMs);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (elapsedMs < minuteMs) {
    return "opened just now";
  }
  if (elapsedMs < hourMs) {
    return `opened ${Math.floor(elapsedMs / minuteMs)}m ago`;
  }
  if (elapsedMs < dayMs) {
    return `opened ${Math.floor(elapsedMs / hourMs)}h ago`;
  }

  const opened = new Date(lastOpenedAtMs);
  const now = new Date(nowMs);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    opened.getFullYear() === yesterday.getFullYear() &&
    opened.getMonth() === yesterday.getMonth() &&
    opened.getDate() === yesterday.getDate()
  ) {
    return "opened yesterday";
  }

  return `opened ${formatCalendarDate(lastOpenedAtMs, opened.getFullYear() !== now.getFullYear())}`;
}

/** Render one Git head badge in the exact branch, unborn, or detached form. */
function GitHeadBadge(props: { summary: ProjectGitSummaryDto }) {
  const { head } = props.summary;
  if (head === null) {
    return null;
  }

  const label = head.kind === "detached" ? `(${head.shortOid})` : head.name;
  return (
    <span
      className="max-w-[240px] truncate rounded-sm bg-surface-card px-1.5 py-0.5 font-mono text-[11px] text-body-strong"
      title={label}
    >
      {label}
    </span>
  );
}

/** Build the textual Git summary that follows the optional head badge. */
function gitSummaryText(summary: ProjectGitSummaryDto): string {
  if (summary.repositoryKind === "notRepository") {
    return "Not a Git repository";
  }
  if (summary.repositoryKind === "bare") {
    return "Bare repository";
  }
  if (summary.head?.kind === "unborn") {
    return "no commits yet";
  }
  if (summary.changedCount === 0) {
    return "clean";
  }

  const changed = `${summary.changedCount} changed`;
  return summary.untrackedCount > 0 ? `${changed} · ${summary.untrackedCount} untracked` : changed;
}

/** Render the header's branch/status/timestamp line. */
function ProjectGitLine(props: {
  project: ProjectDto;
  gitSummary: ProjectGitSummaryDto | null;
  gitPhase: ProjectOverviewGitPhase;
}) {
  const { project, gitSummary, gitPhase } = props;
  const now = Date.now();
  const gitText =
    gitPhase === "failed"
      ? "Git status unavailable"
      : gitSummary === null
        ? null
        : gitSummaryText(gitSummary);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-muted">
      {gitPhase === "loading" ? (
        <span
          role="status"
          aria-label="Loading Git status"
          className="h-4 w-36 animate-pulse rounded bg-surface-card"
        />
      ) : (
        <>
          <GitBranch aria-hidden="true" className="size-3.5 shrink-0 text-muted-soft" />
          {gitSummary !== null && gitSummary.repositoryKind !== "notRepository" && (
            <GitHeadBadge summary={gitSummary} />
          )}
          {gitText !== null && <span>{gitText}</span>}
        </>
      )}
      <span aria-hidden="true">·</span>
      <span>{formatAddedAt(project.addedAtMs, now)}</span>
      <span aria-hidden="true">·</span>
      <span>{formatOpenedAt(project.lastOpenedAtMs, now)}</span>
    </div>
  );
}

/** Render the complete overview header while leaving every project command to the route. */
export function ProjectOverviewHeader(props: ProjectOverviewHeaderProps) {
  const { project, isActionsBusy } = props;
  const isUnavailable = project.availability.status === "unavailable";
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (copyTimer.current !== null) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  /** Copy the full root path and keep the temporary success state bounded to this mount. */
  async function copyPath(): Promise<void> {
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }

    try {
      await navigator.clipboard.writeText(project.rootPath);
      if (!isMounted.current) {
        return;
      }
      setCopyState("copied");
      setCopyAnnouncement("Path copied");
      copyTimer.current = setTimeout(() => {
        setCopyState("idle");
        copyTimer.current = null;
      }, 2_000);
    } catch {
      if (!isMounted.current) {
        return;
      }
      setCopyState("idle");
      setCopyAnnouncement("XWork couldn't copy the path.");
    }
  }

  const copyLabel = copyState === "copied" ? "Copied" : "Copy path";
  const newSessionReason = isUnavailable
    ? "The project folder is unavailable."
    : "Session creation isn't available yet.";

  return (
    <header className="flex min-w-0 flex-col gap-4 @min-[760px]:flex-row @min-[760px]:items-start @min-[760px]:justify-between @min-[760px]:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate font-display text-[28px] leading-tight tracking-tight text-ink">
            {project.displayName}
          </h1>
          {project.isPinned && (
            <span className="inline-flex shrink-0 text-muted-soft">
              <Pin aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Pinned</span>
            </span>
          )}
          {isUnavailable && (
            <span className="shrink-0 rounded-sm bg-warn-surface px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
              Unavailable
            </span>
          )}
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-1">
          <p className="min-w-0 truncate font-mono text-xs text-muted" title={project.rootPath}>
            {project.rootPath}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copyLabel}
                className="text-muted"
                onClick={() => void copyPath()}
              >
                {copyState === "copied" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Clipboard aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copyLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Open folder"
                disabled={isUnavailable || isActionsBusy}
                className="text-muted"
                onClick={props.onOpenFolder}
              >
                <FolderOpen aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open folder</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-2">
          <ProjectGitLine
            project={project}
            gitSummary={props.gitSummary}
            gitPhase={props.gitPhase}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-disabled="true"
              className="cursor-default aria-disabled:opacity-60"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              New Session
            </Button>
          </TooltipTrigger>
          <TooltipContent>{newSessionReason}</TooltipContent>
        </Tooltip>
        <ProjectActionsMenu
          project={project}
          isBusy={isActionsBusy}
          onRename={props.onOpenRename}
          onTogglePinned={props.onTogglePinned}
          onOpenFolder={props.onOpenFolder}
          onLocateFolder={props.onLocateFolder}
          onRemove={props.onRequestRemove}
        />
      </div>

      <span aria-live="polite" className="sr-only">
        {copyAnnouncement}
      </span>
    </header>
  );
}

/** Render the unavailable reason and the two direct recovery intents. */
export function ProjectUnavailableBanner(props: {
  project: ProjectDto;
  isActionsBusy: boolean;
  onLocateFolder(): void;
  onRequestRemove(): void;
}) {
  const { project } = props;
  if (project.availability.status !== "unavailable") {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber/40 bg-warn-surface px-4 py-3.5 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:justify-between">
      <div className="flex min-w-0 gap-2.5">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn-ink" />
        <div>
          <p className="font-medium text-warn-ink">
            {unavailableReasonMessage(project.availability.reason)}
          </p>
          <p className="mt-0.5 text-[13px] text-body">
            Sessions cannot start until the path is valid again.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={props.isActionsBusy}
          onClick={props.onLocateFolder}
        >
          Locate folder…
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={props.isActionsBusy}
          onClick={props.onRequestRemove}
        >
          Remove Project
        </Button>
      </div>
    </section>
  );
}
