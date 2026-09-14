import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEventDto } from "@/bindings/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createCalendarEvent } from "@/lib/ipc/calendar";
import { eventFieldErrors, eventMutationCopy, eventNeedsReload } from "./calendar-error-copy";
import { viewerTimeZone } from "./calendar-presentation";
import { EventForm } from "./event-form";
import {
  type EventFieldErrors,
  eventInput,
  newEventDraft,
  validateEventDraft,
} from "./event-form-state";
import type { CalendarBoundary } from "./use-calendar-query";

export interface EventCreateDialogProps {
  date: string;
  projectId: string | null;
  boundary: CalendarBoundary;
  readBoundary(): CalendarBoundary;
  onCreated(event: CalendarEventDto): void;
  onClose(): void;
  restoreFocus(): void;
}

/** Own one manually saved create draft and retire every late mutation response. */
export function EventCreateDialog({
  date,
  projectId,
  boundary,
  readBoundary,
  onCreated,
  onClose,
  restoreFocus,
}: EventCreateDialogProps) {
  const [initial] = useState(
    /** Freeze prefill within this create lifetime. */ () =>
      newEventDraft(date, projectId, viewerTimeZone()),
  );
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<EventFieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const epoch = useRef(boundary.epoch);
  const content = useRef<HTMLDivElement>(null);
  const userClosed = useRef(false);
  const admitted = useCallback(
    /** Read synchronous admission before dispatch and publication. */ () => {
      const live = readBoundary();
      return alive.current && !live.suspended && live.epoch === epoch.current;
    },
    [readBoundary],
  );
  useEffect(
    /** Retire asynchronous callbacks when the modal leaves its owner. */ () => {
      alive.current = true;
      return /** Deny late create responses. */ () => {
        alive.current = false;
      };
    },
    [],
  );
  /** Ask before discarding editable input, but never interrupt a pending write. */
  function close() {
    if (!admitted() || lock.current) return;
    if (JSON.stringify(draft) !== JSON.stringify(initial)) setDiscard(true);
    else {
      userClosed.current = true;
      onClose();
    }
  }
  /** Validate and synchronously lock exactly one create command. */
  async function save() {
    if (!admitted() || lock.current || blocked) return;
    const issues = validateEventDraft(draft);
    setErrors(issues);
    if (Object.keys(issues).length) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await createCalendarEvent(eventInput(draft));
      if (admitted()) onCreated(result);
    } catch (failure) {
      if (admitted()) {
        setError(failure);
        setErrors(eventFieldErrors(failure));
        setBlocked(eventNeedsReload(failure));
      }
    } finally {
      if (admitted()) {
        lock.current = false;
        setSaving(false);
      }
    }
  }
  return (
    <Dialog
      open={!boundary.suspended && boundary.epoch === epoch.current}
      onOpenChange={
        /** Route Escape and Close through explicit discard admission. */ (open) => {
          if (!open) close();
        }
      }
    >
      <DialogContent
        ref={content}
        showCloseButton={!saving}
        className="top-0 right-0 left-auto flex h-[calc(100dvh/var(--ui-scale))] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-[480px]"
        onOpenAutoFocus={
          /** Focus the title after the accessible dialog mounts. */ (event) => {
            event.preventDefault();
            if (admitted())
              content.current?.querySelector<HTMLInputElement>('[name="title"]')?.focus();
          }
        }
        onCloseAutoFocus={
          /** Restore only a live opener after the focus trap exits. */ (event) => {
            event.preventDefault();
            const live = readBoundary();
            if (userClosed.current && !live.suspended && live.epoch === epoch.current)
              restoreFocus();
          }
        }
      >
        <DialogTitle className="shrink-0 border-b border-hairline px-6 py-4 font-display text-[24px]">
          New Event
        </DialogTitle>
        <DialogDescription className="sr-only">Create a calendar event</DialogDescription>
        {error != null && <p role="alert">{eventMutationCopy(error)}</p>}
        {discard ? (
          <div role="alertdialog" aria-label="Discard changes?" className="space-y-3">
            <p>Discard changes?</p>
            <Button
              type="button"
              onClick={/** Return to the intact draft. */ () => setDiscard(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={
                /** Discard only after explicit confirmation and live admission. */ () => {
                  if (admitted() && !lock.current) {
                    userClosed.current = true;
                    onClose();
                  }
                }
              }
            >
              Discard changes
            </Button>
          </div>
        ) : (
          <EventForm
            draft={draft}
            errors={errors}
            disabled={saving || blocked}
            saving={saving}
            admitted={admitted}
            onChange={
              /** Preserve the user's edits and clear corrected field errors. */ (value) => {
                setDraft(value);
                setErrors({});
              }
            }
            onSubmit={save}
            onCancel={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
