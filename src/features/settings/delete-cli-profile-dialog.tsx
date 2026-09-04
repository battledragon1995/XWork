import { useRef } from "react";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CliProfilesFailure } from "./cli-profile-error-copy";

/** What the page hands the dialog. A `null` target is what keeps it closed. */
export interface DeleteCliProfileDialogProps {
  target: CliProfileDto | null;
  isPending: boolean;
  failure: CliProfilesFailure | null;
  onCancel(): void;
  onConfirm(profileId: string): void;
}

/**
 * Confirm deleting one custom profile. The impact copy states only what BE-006 guarantees:
 * running terminals keep running, and no session count is invented for a number the backend
 * never reported.
 */
export function DeleteCliProfileDialog(props: DeleteCliProfileDialogProps) {
  const { target, isPending, failure } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  // A built-in has no delete affordance at all; this guard exists so a future caller cannot
  // route one into a destructive flow the backend would refuse anyway.
  const isOpen = target?.kind === "custom";
  const isRetry = failure?.retryable === true;

  return (
    <Dialog
      onOpenChange={(next) => {
        // A deletion is already on its way, so closing now would hide its outcome.
        if (!next && !isPending) {
          props.onCancel();
        }
      }}
      open={isOpen}
    >
      {target !== null && (
        <DialogContent
          className="gap-5"
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
          onOpenAutoFocus={(event) => {
            // The safe action holds focus so a stray Enter cannot delete anything.
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Delete {target.name}?</DialogTitle>
            <DialogDescription>
              Terminals that are already running are not stopped. The profile disappears from the
              next selection and launch.
            </DialogDescription>
          </DialogHeader>

          {failure !== null && (
            <p className="text-[13px] text-error" role="alert">
              {failure.message}
            </p>
          )}

          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={props.onCancel}
              ref={cancelRef}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() => props.onConfirm(target.id)}
              type="button"
              variant="destructive"
            >
              {isPending ? "Deleting…" : isRetry ? "Try again" : "Delete Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
