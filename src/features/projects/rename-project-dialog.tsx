import { type RefObject, useRef, useState } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectActionFailure } from "./use-project-actions";

/** Longest display name the backend accepts, counted in Unicode scalar values. */
const DISPLAY_NAME_MAX_SCALARS = 255;

/** Control characters, the one class of input the backend rejects outright. */
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Requirement shown while the typed name cannot be submitted, worded as the backend does. */
const NAME_REQUIREMENT = "Enter a name between 1 and 255 characters, without control characters.";

/** What the route hands the dialog. `project` being `null` is what keeps it closed. */
export interface RenameProjectDialogProps {
  project: ProjectDto | null;
  isPending: boolean;
  failure: ProjectActionFailure | null;
  onCancel(): void;
  onSubmit(displayName: string): void;
}

/**
 * Decide whether one typed name can be submitted at all. The rules mirror the backend's
 * `normalize_display_name` so an invalid name never becomes a round trip: trim first, then
 * measure in scalar values so an astral emoji counts once, and reject control characters.
 */
export function isValidDisplayName(value: string): boolean {
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;

  return length >= 1 && length <= DISPLAY_NAME_MAX_SCALARS && !CONTROL_CHARACTERS.test(trimmed);
}

/**
 * Ask for a new display name for one project. The dialog owns the typed value and the
 * front-end validation only; the command, the failure classification and the closing decision
 * all stay with the caller, so `FE-005` can reuse this component unchanged.
 */
export function RenameProjectDialog(props: RenameProjectDialogProps) {
  const { project, isPending, failure, onCancel, onSubmit } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(open) => {
        // A command is running, so there is nothing to go back to yet: the dialog stays open
        // until the backend answers.
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      {project !== null && (
        <DialogContent
          // Keyed by project so reopening on another card starts from that card's name rather
          // than whatever was typed last.
          key={project.id}
          showCloseButton={false}
          className="gap-5 sm:max-w-[460px]"
          onOpenAutoFocus={(event) => {
            // Focus the field and select the whole current name, so typing replaces it in one
            // keystroke instead of appending to it.
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
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
          <RenameForm
            project={project}
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

// Render the dialog body for one project. Split out so its typed value is created fresh with
// each opening rather than surviving as stale state on the closed dialog.
function RenameForm(props: {
  project: ProjectDto;
  inputRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  failure: ProjectActionFailure | null;
  onCancel(): void;
  onSubmit(displayName: string): void;
}) {
  const { project, inputRef, isPending, failure, onCancel, onSubmit } = props;
  const [value, setValue] = useState(project.displayName);

  const trimmed = value.trim();
  const isValid = isValidDisplayName(value);
  const isUnchanged = trimmed === project.displayName.trim();
  const canSubmit = isValid && !isUnchanged && !isPending;

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
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>
          This changes the name in XWork only. The folder keeps its own name.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <label htmlFor="rename-project-name" className="text-[13px] font-medium text-body-strong">
          Display name
        </label>
        <Input
          id="rename-project-name"
          ref={inputRef}
          value={value}
          disabled={isPending}
          aria-invalid={!isValid}
          aria-describedby={isValid ? undefined : "rename-project-hint"}
          onChange={(event) => setValue(event.target.value)}
        />
        {!isValid && (
          <p id="rename-project-hint" className="text-xs text-muted">
            {NAME_REQUIREMENT}
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
