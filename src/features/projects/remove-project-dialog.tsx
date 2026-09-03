import { TriangleAlert } from "lucide-react";
import type { RemoveProjectImpactDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectActionFailure, RemoveProjectTarget } from "./use-project-actions";

/** What the route hands the dialog. `target` being `null` is what keeps it closed. */
export interface RemoveProjectDialogProps {
  target: RemoveProjectTarget | null;
  isPending: boolean;
  failure: ProjectActionFailure | null;
  onCancel(): void;
  onConfirm(projectId: string): void;
}

/**
 * List the consequences of one removal, in singular or plural form. Only a non-zero count
 * produces a line: at Stage 4 the backend's runtime guard reports zeroes, so the block is
 * normally absent, and it must never be padded with facts nobody measured.
 */
export function removalFacts(impact: RemoveProjectImpactDto): string[] {
  const facts: string[] = [];

  if (impact.sessionCount > 0) {
    facts.push(
      impact.sessionCount === 1
        ? "1 session will be stopped first."
        : `${impact.sessionCount} sessions will be stopped first.`,
    );
  }

  if (impact.runningProcessCount > 0) {
    facts.push(
      impact.runningProcessCount === 1
        ? "1 running process will be stopped."
        : `${impact.runningProcessCount} running processes will be stopped.`,
    );
  }

  if (impact.unsavedFileCount > 0) {
    facts.push(
      impact.unsavedFileCount === 1
        ? "1 file with unsaved changes will lose them."
        : `${impact.unsavedFileCount} files with unsaved changes will lose them.`,
    );
  }

  return facts;
}

/**
 * Confirm forgetting one project. The copy states plainly that nothing on disk is touched,
 * because that is the single most important thing the user needs to know before agreeing.
 * `FE-005` reuses this exact component from its own header menu.
 */
export function RemoveProjectDialog(props: RemoveProjectDialogProps) {
  const { target, isPending, failure, onCancel, onConfirm } = props;
  const impact = target?.impact ?? null;
  const facts = impact === null ? [] : removalFacts(impact);
  // A cleanup failure left the project in place, so the same button is now a second attempt.
  const isRetry = failure?.kind === "retryable" && failure.retry === "remove";

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        // Removal is running: closing now would hide the outcome of a change already sent.
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      {target !== null && impact !== null && (
        <DialogContent
          showCloseButton={false}
          className="gap-5 sm:max-w-[460px]"
          onEscapeKeyDown={(event) => {
            if (isPending) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (isPending) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove {target.project.displayName} from XWork?</DialogTitle>
            <DialogDescription>
              The folder <span className="font-mono text-xs">{impact.rootPath}</span> and every file
              in it stay exactly where they are. XWork only forgets the project. Notes and events
              linked to it stay, unlinked.
            </DialogDescription>
          </DialogHeader>

          {facts.length > 0 && (
            <ul className="grid gap-2 rounded-md bg-surface-card px-3.5 py-3 text-[13px] text-body-strong">
              {facts.map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn-ink" />
                  {fact}
                </li>
              ))}
            </ul>
          )}

          {failure !== null && (
            <p role="alert" className="text-[13px] text-error">
              {failure.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => onConfirm(target.project.id)}
            >
              {isPending ? "Removing…" : isRetry ? "Try again" : "Remove Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
