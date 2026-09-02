import { Layers } from "lucide-react";
import type { QuitSummaryDto } from "@/bindings/app-lifecycle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuitStore } from "./quit-store";

/** Copy shown when the backend could not take a runtime snapshot. */
const SNAPSHOT_FAILURE_MESSAGE = "Couldn't check what is still running. XWork stays open.";
/** Copy shown when the backend could not stop the runtime, so nothing was closed. */
const SHUTDOWN_FAILURE_MESSAGE = "XWork couldn't stop everything, so nothing was closed.";

// Pick the singular or plural noun for one count.
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Render the runtime counts the confirmation has to state. §5.4 requires the session and
// process lines unconditionally; the unsaved-file line only appears when there is one.
function QuitFacts(props: { summary: QuitSummaryDto }) {
  const { sessionCount, projectCount, runningProcessCount, unsavedFileCount } = props.summary;

  return (
    <div className="mt-3.5 flex flex-col gap-1 rounded-md bg-surface-card px-3.5 py-3 text-[13px]">
      <span className="flex items-center gap-1.5">
        <Layers aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        {`${plural(sessionCount, "session", "sessions")} across ${plural(projectCount, "project", "projects")}`}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-teal" />
        {plural(runningProcessCount, "running process", "running processes")}
      </span>
      {unsavedFileCount > 0 && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ink" />
          {unsavedFileCount === 1
            ? "1 file with unsaved changes"
            : `${unsavedFileCount} files with unsaved changes`}
        </span>
      )}
      <span className="mt-1 text-xs text-muted-soft">
        To keep working in the background, close the window instead — XWork stays in the tray.
      </span>
    </div>
  );
}

/**
 * Host the single Quit confirmation. Both entry points — the wordmark menu and the tray —
 * share this dialog through the store, so a second dialog can never appear.
 */
export function QuitDialog() {
  const phase = useQuitStore((state) => state.phase);
  const request = useQuitStore((state) => state.request);
  const failure = useQuitStore((state) => state.failure);
  const cancel = useQuitStore((state) => state.cancelQuit);
  const confirm = useQuitStore((state) => state.confirmQuit);
  const retrySnapshot = useQuitStore((state) => state.startQuit);

  const isSnapshotFailure = phase === "snapshot-failed";
  const isConfirming = phase === "confirming";
  const isOpen = isSnapshotFailure || isConfirming || request !== null;
  const hasShutdownFailure = failure?.stage === "shutdown";

  // Escape and an outside interaction are both Cancel, but only while cancelling is allowed;
  // during confirmation the dialog stays locked until the backend answers.
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen || isConfirming) {
      return;
    }

    void cancel();
  }

  // Return focus to the wordmark, which is the frontend entry point of this flow.
  function handleCloseAutoFocus(event: Event) {
    event.preventDefault();
    document.querySelector<HTMLElement>('[aria-label="XWork menu"]')?.focus();
  }

  const primaryLabel = isConfirming ? "Quitting…" : hasShutdownFailure ? "Try again" : "Quit";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (isConfirming) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Quit XWork?</DialogTitle>
          <DialogDescription>
            {isSnapshotFailure
              ? SNAPSHOT_FAILURE_MESSAGE
              : "Quitting stops every session. Sessions, tabs, panes and terminal output are not restored the next time XWork opens. Projects, notes, events and settings are kept."}
          </DialogDescription>
        </DialogHeader>

        {!isSnapshotFailure && request !== null && <QuitFacts summary={request.summary} />}
        {hasShutdownFailure && <p className="text-[13px] text-error">{SHUTDOWN_FAILURE_MESSAGE}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={isConfirming} onClick={() => void cancel()}>
            Cancel
          </Button>
          {isSnapshotFailure ? (
            <Button onClick={() => void retrySnapshot()}>Try again</Button>
          ) : (
            <Button variant="destructive" disabled={isConfirming} onClick={() => void confirm()}>
              {primaryLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
