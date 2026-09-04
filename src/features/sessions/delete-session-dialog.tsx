import { TriangleAlert } from "lucide-react";
import type { CloseImpactDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildDeleteSessionFacts, type SessionsFailure } from "@/lib/utils/session-copy";

/** Sentence the confirmation always states, whatever the measured impact turns out to be. */
export const DELETE_SESSION_DESCRIPTION =
  "Everything in this session is stopped and removed: its tabs, panes and terminal output. This cannot be undone.";

/** What the route hands the dialog. `session` being `null` is what keeps it closed. */
export interface DeleteSessionDialogProps {
  session: SessionSummaryDto | null;
  impact: CloseImpactDto | null;
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onConfirm(): void;
  onRetryImpact(): void;
  /**
   * Called while the dialog gives up focus. Radix restores focus to whatever was focused
   * before it opened, and that can be a menu item which has already unmounted, so focus
   * would otherwise land on the document body instead of the control the user pressed.
   */
  onClosed(): void;
}

/**
 * Confirm deleting the session the route is showing.
 *
 * Deleting a session always asks, even when the backend reports no blocker at all, because
 * the output and layout it destroys are not recoverable. The facts box lists only measured
 * blockers, so it disappears entirely for a session that has none.
 */
export function DeleteSessionDialog(props: DeleteSessionDialogProps) {
  const { session, impact, isPending, failure, onCancel, onConfirm, onRetryImpact, onClosed } =
    props;
  const facts = impact === null ? [] : buildDeleteSessionFacts(impact);
  // The impact read failed, so the only useful action is asking for the facts again.
  const needsImpact = impact === null && failure?.code === "contentLifecycleFailed";
  // A failed close left the session in place, so the same button is now a second attempt.
  const isRetry = impact !== null && failure?.canRetry === true;
  // The runtime is already closing this session, so pressing again cannot help.
  const isLocked = failure?.code === "closeInProgress";

  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        // The close is running: hiding it now would hide the outcome of a change already sent.
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      {session !== null && (
        <DialogContent
          showCloseButton={false}
          className="gap-5 sm:max-w-[460px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed();
          }}
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
            <DialogTitle>Delete session “{session.name}”?</DialogTitle>
            <DialogDescription>{DELETE_SESSION_DESCRIPTION}</DialogDescription>
          </DialogHeader>

          {facts.length > 0 && (
            <ul className="grid gap-2 rounded-md bg-surface-card px-3.5 py-3 text-[13px] text-body-strong">
              {facts.map((fact) => (
                <li key={fact} className="flex items-start gap-2">
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-warn-ink"
                  />
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
            {needsImpact ? (
              <Button type="button" disabled={isPending} onClick={onRetryImpact}>
                Try again
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={isPending || isLocked}
                onClick={onConfirm}
              >
                {isPending ? "Deleting…" : isRetry ? "Try again" : "Delete Session"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
