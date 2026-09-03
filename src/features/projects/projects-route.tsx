import { FolderPlus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectCard } from "./project-card";
import type { AddProjectFailure, ProjectActionFailure } from "./project-error-copy";
import { RemoveProjectDialog } from "./remove-project-dialog";
import { RenameProjectDialog } from "./rename-project-dialog";
import { useAddProject } from "./use-add-project";
import { useProjectActions } from "./use-project-actions";
import { useProjects } from "./use-projects";
import { useProjectSearch } from "./use-project-search";

/**
 * Build the count line under the page title. Every count except `matching` comes from the
 * unfiltered snapshot, so filtering the grid never makes the page look like projects vanished.
 */
export function projectCountSummary(projects: ProjectDto[], matching: number | null): string {
  const parts = [projects.length === 1 ? "1 project" : `${projects.length} projects`];
  const pinned = projects.filter((project) => project.isPinned).length;
  const unavailable = projects.filter(
    (project) => project.availability.status === "unavailable",
  ).length;

  if (pinned > 0) {
    parts.push(`${pinned} pinned`);
  }

  if (unavailable > 0) {
    parts.push(`${unavailable} unavailable`);
  }

  if (matching !== null) {
    parts.push(`${matching} matching`);
  }

  return parts.join(" · ");
}

/**
 * The `/projects` page: header, backend search, the responsive card grid and both project
 * dialogs. The route owns no project data and no persistence — it composes the shared store,
 * the search hook, the Add Project flow and the action coordinator, and it owns exactly one
 * thing of its own: where focus goes when a card or a dialog disappears.
 */
export function ProjectsRoute() {
  const snapshot = useProjects();
  const search = useProjectSearch(snapshot);
  const add = useAddProject();
  const navigate = useNavigate();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  /** Live `More actions` element per project, so focus can return to a specific card. */
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());

  /** Set by a successful removal, because focus then belongs to search, not to a dead card. */
  const removalSucceeded = useRef(false);

  const handleRemoved = useCallback(() => {
    removalSucceeded.current = true;
  }, []);

  const actions = useProjectActions({ onRemoved: handleRemoved });

  // Record where a card's menu trigger currently lives, keyed by the project it belongs to.
  const registerTrigger = useCallback((projectId: string, element: HTMLButtonElement | null) => {
    if (element === null) {
      triggerRefs.current.delete(projectId);
      return;
    }

    triggerRefs.current.set(projectId, element);
  }, []);

  /** Project whose rename dialog was open, remembered so focus can go back to its card. */
  const lastRenameId = useRef<string | null>(null);

  useEffect(() => {
    if (actions.renameTarget !== null) {
      lastRenameId.current = actions.renameTarget.id;
      return;
    }

    const projectId = lastRenameId.current;
    if (projectId === null) {
      return;
    }

    lastRenameId.current = null;
    // The card survives a rename and a pin reorder because it is keyed by project id, so its
    // menu trigger is still the right place to put focus back.
    triggerRefs.current.get(projectId)?.focus();
  }, [actions.renameTarget]);

  /** Project whose remove dialog was open, remembered for the same reason. */
  const lastRemoveId = useRef<string | null>(null);

  useEffect(() => {
    if (actions.removeTarget !== null) {
      lastRemoveId.current = actions.removeTarget.project.id;
      return;
    }

    const projectId = lastRemoveId.current;
    if (projectId === null) {
      return;
    }

    lastRemoveId.current = null;

    if (removalSucceeded.current) {
      // The card that opened the dialog no longer exists, so search is the nearest control.
      removalSucceeded.current = false;
      searchInputRef.current?.focus();
      return;
    }

    triggerRefs.current.get(projectId)?.focus();
  }, [actions.removeTarget]);

  // Hand focus back to the page's own Add Project button after a cancelled picker.
  const restoreAddFocus = useCallback(() => {
    addButtonRef.current?.focus();
  }, []);

  // Empty the search box and keep the caret where the user left it.
  const clearSearch = useCallback(() => {
    search.clear();
    searchInputRef.current?.focus();
  }, [search]);

  const hasQuery = search.query.trim() !== "";
  const matching = hasQuery && search.status === "ready" ? search.projects.length : null;
  const showCount = snapshot.status === "ready" || snapshot.projects.length > 0;
  const isFirstLoad = search.status === "loading" && search.projects.length === 0;

  return (
    <div className="@container h-full">
      <div className="flex h-full flex-col gap-5 overflow-x-hidden px-8 py-7">
        <header className="flex flex-col gap-4 @min-[760px]:flex-row @min-[760px]:items-end @min-[760px]:justify-between @min-[760px]:gap-6">
          <div>
            <h1 className="font-display text-[28px] leading-tight tracking-tight text-ink">
              Projects
            </h1>
            {showCount && (
              <p className="mt-1 text-[13px] text-muted">
                {projectCountSummary(snapshot.projects, matching)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 @min-[760px]:flex-row @min-[760px]:items-center">
            <div className="relative @min-[760px]:w-[260px]">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-soft"
              />
              <Input
                ref={searchInputRef}
                // Deliberately not `type="search"`: the browser's own clear affordance would
                // duplicate the `Clear search` control this page already owns.
                type="text"
                value={search.query}
                aria-label="Search projects by name or path"
                placeholder="Search by name or path"
                className="pr-8 pl-8 text-[13px]"
                onChange={(event) => search.setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // A local shortcut only: the global shortcut catalogue is not this slice's.
                  if (event.key === "Escape" && search.query !== "") {
                    event.preventDefault();
                    search.clear();
                  }
                }}
              />
              {search.query !== "" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Clear search"
                      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted"
                      onClick={clearSearch}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              )}
            </div>

            <Button
              ref={addButtonRef}
              type="button"
              disabled={add.isAdding}
              onClick={() => void add.startAdd(restoreAddFocus)}
            >
              <FolderPlus aria-hidden="true" className="size-3.5" />
              {add.isAdding ? "Selecting folder…" : "Add Project"}
            </Button>
          </div>
        </header>

        {add.failure !== null && (
          <AddFailureLine
            failure={add.failure}
            onDismiss={add.dismissFailure}
            onOpenDuplicate={add.openDuplicate}
          />
        )}

        {actions.failure !== null && (
          <ActionFailureLine
            failure={actions.failure}
            onDismiss={actions.dismissFailure}
            onRetry={() => void actions.retryFailure()}
            onOpenDuplicate={(projectId) => void navigate(`/projects/${projectId}`)}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {search.failure !== null ? (
            <div
              role="alert"
              className="flex h-full flex-col items-center justify-center gap-3 text-center"
            >
              <p className="text-[15px] text-body">{search.failure.message}</p>
              {search.failure.kind === "retryable" && (
                <Button type="button" variant="outline" onClick={search.refresh}>
                  Try again
                </Button>
              )}
            </div>
          ) : isFirstLoad ? (
            <div role="status" aria-busy="true" className="h-full">
              {/* No skeleton on purpose: a fake grid would move focus targets around the
                  moment the real list arrives. */}
              <span className="sr-only">Loading your projects…</span>
            </div>
          ) : search.projects.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex max-w-[420px] flex-col items-center gap-3 rounded-lg border border-hairline border-dashed px-8 py-10 text-center">
                <h2 className="font-display text-[20px] text-ink">
                  {hasQuery ? "No match" : "No projects yet"}
                </h2>
                <p className="text-[13px] text-muted">
                  {hasQuery
                    ? `No project name or path contains "${search.query}".`
                    : "Add a folder that already exists on this machine. XWork never creates, copies or clones anything."}
                </p>
                {hasQuery ? (
                  <Button type="button" variant="outline" onClick={clearSearch}>
                    Clear search
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={add.isAdding}
                    onClick={() => void add.startAdd(restoreAddFocus)}
                  >
                    <FolderPlus aria-hidden="true" className="size-3.5" />
                    {add.isAdding ? "Selecting folder…" : "Add Project"}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 @min-[760px]:grid-cols-2 @min-[1100px]:grid-cols-3">
              {search.projects.map((project) => (
                // Keyed by backend id, never by index: pinning reorders the grid and the DOM
                // node has to travel with its project so focus stays on the same card.
                <ProjectCard
                  key={project.id}
                  project={project}
                  isBusy={actions.pendingProjectId === project.id}
                  registerTrigger={registerTrigger}
                  onOpen={() => void navigate(`/projects/${project.id}`)}
                  onRename={() => actions.openRename(project)}
                  onTogglePinned={() => void actions.togglePinned(project)}
                  onOpenFolder={() => void actions.openFolder(project)}
                  onLocateFolder={() => void actions.locateFolder(project)}
                  onRemove={() => void actions.requestRemove(project)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <RenameProjectDialog
        project={actions.renameTarget}
        isPending={actions.pendingOperation === "rename"}
        failure={actions.renameTarget === null ? null : actions.failure}
        onCancel={actions.closeRename}
        onSubmit={(displayName) => {
          if (actions.renameTarget !== null) {
            void actions.rename(actions.renameTarget.id, displayName);
          }
        }}
      />

      <RemoveProjectDialog
        target={actions.removeTarget}
        isPending={actions.pendingOperation === "remove"}
        failure={actions.removeTarget === null ? null : actions.failure}
        onCancel={actions.closeRemove}
        onConfirm={(projectId) => void actions.confirmRemove(projectId)}
      />
    </div>
  );
}

// Render the shared Add Project failure, with the one recovery a duplicate folder allows.
function AddFailureLine(props: {
  failure: AddProjectFailure;
  onDismiss(): void;
  onOpenDuplicate(projectId: string): void;
}) {
  const { failure } = props;

  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
      {failure.message}
      {failure.kind === "duplicate" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-brand underline underline-offset-4"
          onClick={() => props.onOpenDuplicate(failure.projectId)}
        >
          Open project
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted underline underline-offset-4"
        onClick={props.onDismiss}
      >
        Dismiss
      </Button>
    </p>
  );
}

/** Label of the recovery control, taken from the operation the failure says to repeat. */
function retryLabel(retry: string | null): string {
  if (retry === "locate") {
    return "Locate folder…";
  }

  if (retry === "openFolder") {
    return "Open folder";
  }

  return "Try again";
}

// Render one failed project action and whichever recovery the classification allows.
function ActionFailureLine(props: {
  failure: ProjectActionFailure;
  onDismiss(): void;
  onRetry(): void;
  onOpenDuplicate(projectId: string): void;
}) {
  const { failure } = props;

  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
      {failure.message}
      {failure.kind === "retryable" && failure.retry !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-brand underline underline-offset-4"
          onClick={props.onRetry}
        >
          {retryLabel(failure.retry)}
        </Button>
      )}
      {failure.kind === "duplicate" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-brand underline underline-offset-4"
          onClick={() => props.onOpenDuplicate(failure.projectId)}
        >
          Open project
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted underline underline-offset-4"
        onClick={props.onDismiss}
      >
        Dismiss
      </Button>
    </p>
  );
}
