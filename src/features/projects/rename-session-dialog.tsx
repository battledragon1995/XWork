import { type RefObject, useRef, useState } from "react";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SESSION_NAME_REQUIREMENT,
  type SessionsFailure,
  validateSessionName,
} from "@/lib/utils/session-copy";

/** What the overview hands the dialog. `session` being `null` is what keeps it closed. */
export interface RenameSessionDialogProps {
  session: SessionSummaryDto | null;
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onSubmit(name: string): void;
  /**
   * Called while the dialog gives up focus. Radix restores focus to whatever was focused
   * before it opened, and that was a menu item which has already unmounted, so focus would
   * otherwise land on the document body instead of the control the user pressed.
   */
  onClosed(): void;
}

/**
 * Ask for a new name for one session from the project overview.
 *
 * Every pure rule this dialog applies — the name check and the requirement sentence — comes
 * from `src/lib/utils/session-copy.ts`, which is the whole reason the session route can keep
 * its own copy of this dialog without the two wordings ever drifting apart.
 */
export function RenameSessionDialog(props: RenameSessionDialogProps) {
  const { session, isPending, failure, onCancel, onSubmit, onClosed } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        // A command is running, so there is nothing to go back to yet: the dialog stays open
        // until the backend answers.
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      {session !== null && (
        <DialogContent
          // Keyed by session so reopening on another row starts from that row's name rather
          // than whatever was typed last.
          key={session.id}
          showCloseButton={false}
          className="gap-5 sm:max-w-[460px]"
          onOpenAutoFocus={(event) => {
            // Focus the field and select the whole current name, so typing replaces it in one
            // keystroke instead of appending to it.
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
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
          <RenameSessionForm
            session={session}
            inputRef={inputRef}
            isPending={isPending}
            failure={failure}
            onCancel={onCancel}
            onSubmit={onSubmit}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

// Render the dialog body for one session. Split out so its typed value is created fresh with
// each opening rather than surviving as stale state on the closed dialog.
function RenameSessionForm(props: {
  session: SessionSummaryDto;
  inputRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onSubmit(name: string): void;
}) {
  const { session, inputRef, isPending, failure, onCancel, onSubmit } = props;
  const [value, setValue] = useState(session.name);

  const { isValid, value: trimmed } = validateSessionName(value);
  const canSubmit = isValid && !isPending;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();

        if (!canSubmit) {
          return;
        }

        onSubmit(trimmed);
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename session</DialogTitle>
      </DialogHeader>

      <div className="grid gap-1.5">
        <label
          htmlFor="rename-project-session-name"
          className="text-[13px] font-medium text-body-strong"
        >
          Session name
        </label>
        <Input
          id="rename-project-session-name"
          ref={inputRef}
          value={value}
          disabled={isPending}
          aria-invalid={!isValid}
          aria-describedby={isValid ? undefined : "rename-project-session-hint"}
          onChange={(event) => setValue(event.target.value)}
        />
        {!isValid && (
          <p id="rename-project-session-hint" className="text-xs text-muted">
            {SESSION_NAME_REQUIREMENT}
          </p>
        )}
      </div>

      {failure !== null && (
        <p role="alert" className="text-[13px] text-error">
          {failure.message}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? "Renaming…" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}
