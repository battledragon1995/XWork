import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { INTEGRATION_MESSAGE } from "./project-error-copy";
import { ProjectGitChanges } from "./project-git-changes";
import { ProjectOverviewHeader, ProjectUnavailableBanner } from "./project-overview-header";
import { ProjectSessionList } from "./project-session-list";
import { RemoveProjectDialog } from "./remove-project-dialog";
import { RenameProjectDialog } from "./rename-project-dialog";
import { type ProjectActionFailure, useProjectActions } from "./use-project-actions";
import { useProjectOverview } from "./use-project-overview";
import { useProjectSessions } from "./use-project-sessions";

/** Render the non-interactive header shape while the initial open is pending. */
function ProjectOverviewSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading project overview"
      className="grid gap-3"
    >
      <span className="h-8 w-52 animate-pulse rounded bg-surface-card" />
      <span className="h-4 w-80 max-w-full animate-pulse rounded bg-surface-card" />
      <span className="h-4 w-64 max-w-full animate-pulse rounded bg-surface-card" />
    </div>
  );
}

/** Choose the recovery label for one action failure. */
function actionRetryLabel(failure: ProjectActionFailure): string {
  if (failure.kind !== "retryable") {
    return "Try again";
  }
  if (failure.retry === "locate") {
    return "Locate folder…";
  }
  if (failure.retry === "openFolder") {
    return "Open folder";
  }
  return "Try again";
}

/** Render an action failure when it is not already owned by an open dialog. */
function ProjectActionFailureLine(props: {
  failure: ProjectActionFailure;
  onRetry(): void;
  onDismiss(): void;
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
          {actionRetryLabel(failure)}
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

/** Compose the Stage 5 project metadata, read-only Git state, actions, and dialogs. */
export function ProjectOverviewRoute() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();

  /** Leave a project that disappeared without surfacing a stale route-level error. */
  const handleGone = useCallback(() => {
    void navigate("/projects");
  }, [navigate]);

  const overview = useProjectOverview({ projectId, onGone: handleGone });
  const actions = useProjectActions({
    onRemoved: handleGone,
    onUnavailable: overview.refreshProject,
  });

  /** Open the session that was just created, which is the only place a create leads. */
  const handleCreated = useCallback(
    (sessionId: string) => {
      void navigate(`/sessions/${sessionId}`);
    },
    [navigate],
  );

  /**
   * The route owns the create flow so the header button can share it with the empty state.
   * Both entry points call this one hook instance, and the hook's own lock is what keeps a
   * double activation from producing two sessions.
   */
  const sessions = useProjectSessions({
    projectId,
    onCreated: handleCreated,
    onProjectGone: handleGone,
    onProjectUnavailable: overview.refreshProject,
  });

  useEffect(() => {
    if (actions.failure?.kind === "gone") {
      // Action commands share the same gone outcome as overview reads; navigation unmounts
      // every menu and dialog, which prevents controls for the removed project lingering.
      handleGone();
    }
  }, [actions.failure, handleGone]);

  if (overview.status === "loading") {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden px-8 py-7">
        <ProjectOverviewSkeleton />
      </div>
    );
  }

  if (overview.status === "failed" || overview.project === null) {
    const failure = overview.failure;
    const message =
      failure === null || failure.kind === "gone"
        ? "XWork couldn't open this project."
        : failure.message;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-hidden px-8 py-7 text-center">
        <p role="alert" className="text-[15px] text-body">
          {message}
        </p>
        {failure?.kind === "retryable" && (
          <Button type="button" variant="outline" onClick={overview.load}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  const project = overview.project;
  const isUnavailable = project.availability.status === "unavailable";
  const isActionsBusy = actions.pendingProjectId === project.id;
  const gitSummary = overview.git.status === "ready" ? overview.git.snapshot.summary : null;
  const dialogOwnsFailure = actions.renameTarget !== null || actions.removeTarget !== null;

  return (
    <div className="@container h-full overflow-y-auto overflow-x-hidden px-8 py-7">
      <div className="grid min-w-0 gap-5">
        <ProjectOverviewHeader
          project={project}
          gitSummary={gitSummary}
          gitPhase={overview.git.status}
          isActionsBusy={isActionsBusy}
          isCreatingSession={sessions.isCreating}
          onCreateSession={() => void sessions.create()}
          onOpenRename={() => actions.openRename(project)}
          onTogglePinned={() => void actions.togglePinned(project)}
          onOpenFolder={() => void actions.openFolder(project)}
          onLocateFolder={() => void actions.locateFolder(project)}
          onRequestRemove={() => void actions.requestRemove(project)}
        />

        {overview.failure !== null && overview.failure.kind !== "gone" && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
            {overview.failure.message}
            {overview.failure.kind === "retryable" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-brand underline underline-offset-4"
                onClick={overview.refreshProject}
              >
                Try again
              </Button>
            )}
          </p>
        )}

        {sessions.createFailure !== null && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
            {sessions.createFailure.message}
            {sessions.createFailure.canRetry && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-brand underline underline-offset-4"
                onClick={() => void sessions.create()}
              >
                Try again
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted underline underline-offset-4"
              onClick={sessions.dismissCreateFailure}
            >
              Dismiss
            </Button>
          </p>
        )}

        {actions.failure !== null && !dialogOwnsFailure && actions.failure.kind !== "gone" && (
          <ProjectActionFailureLine
            failure={actions.failure}
            onRetry={() => void actions.retryFailure()}
            onDismiss={actions.dismissFailure}
            onOpenDuplicate={(duplicateProjectId) =>
              void navigate(`/projects/${duplicateProjectId}`)
            }
          />
        )}

        {isUnavailable ? (
          <ProjectUnavailableBanner
            project={project}
            isActionsBusy={isActionsBusy}
            onLocateFolder={() => void actions.locateFolder(project)}
            onRequestRemove={() => void actions.requestRemove(project)}
          />
        ) : null}

        <div className="grid gap-6 @min-[900px]:grid-cols-[7fr_5fr]">
          <div className="grid min-w-0 gap-6">
            {/* The session block leads the left column; the later right-column features of
                FE-009 and FE-011 are not pulled forward by this slice. */}
            <ProjectSessionList
              projectId={project.id}
              isProjectUnavailable={isUnavailable}
              onCreateSession={() => void sessions.create()}
            />

            {!isUnavailable && (
              <div className="min-w-0">
                {overview.git.status === "loading" && (
                  <div
                    role="status"
                    aria-label="Loading project changes"
                    className="h-20 animate-pulse rounded-md bg-surface-card"
                  />
                )}
                {overview.git.status === "failed" && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-2 text-[13px] text-error"
                  >
                    {overview.git.message}
                    {overview.git.message !== INTEGRATION_MESSAGE && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-brand underline underline-offset-4"
                        onClick={overview.retryGit}
                      >
                        Try again
                      </Button>
                    )}
                  </div>
                )}
                {overview.git.status === "ready" &&
                  overview.git.snapshot.summary.repositoryKind === "worktree" && (
                    <ProjectGitChanges snapshot={overview.git.snapshot} />
                  )}
              </div>
            )}
          </div>
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
        onConfirm={(id) => void actions.confirmRemove(id)}
      />
    </div>
  );
}
