import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEventDto, DeleteCalendarEventImpactDto } from "@/bindings/calendar";
import { Button } from "@/components/ui/button";
import {
  confirmDeleteCalendarEvent,
  onCalendarChanged,
  prepareDeleteCalendarEvent,
} from "@/lib/ipc/calendar";
import { eventMutationCopy, eventNeedsReload } from "./calendar-error-copy";

interface Props {
  event: CalendarEventDto;
  admitted(): boolean;
  onDeleted(): void;
  onCancel(): void;
  onReload(): void;
  onPending(pending: boolean): void;
}

/** Render deletion review inside the existing detail modal, never a second editor. */
export function EventDeleteDialog({
  event,
  admitted,
  onDeleted,
  onCancel,
  onReload,
  onPending,
}: Props) {
  const [preview, setPreview] = useState<DeleteCalendarEventImpactDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState(false);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [listenerError, setListenerError] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const sequence = useRef(0);
  const expires = useRef(0);
  const request = useRef<DeleteCalendarEventImpactDto | null>(null);
  const start = useRef<() => Promise<void>>(null);
  /** Admit only this mounted confirmation lifetime and its latest operation. */
  function valid(ticket: number) {
    return alive.current && admitted() && ticket === sequence.current;
  }
  /** Clear the local authorization without synthesizing a replacement token. */
  const invalidate = useCallback(
    /** Revoke the local token without automatically renewing it. */ () => {
      request.current = null;
      setPreview(null);
      setReview(true);
    },
    [],
  );
  /** Fetch a new impact for a future, separate explicit confirmation. */
  async function prepare() {
    if (!alive.current || !admitted() || lock.current) return;
    const ticket = ++sequence.current;
    lock.current = true;
    onPending(true);
    setPending(true);
    request.current = null;
    setPreview(null);
    setError(null);
    try {
      const impact = await prepareDeleteCalendarEvent({
        eventId: event.id,
        expectedRevision: event.revision,
      });
      if (!valid(ticket)) return;
      request.current = impact;
      expires.current = Date.now() + 60_000;
      setPreview(impact);
      setReview(false);
    } catch (failure) {
      if (valid(ticket)) {
        setError(failure);
        setBlocked(eventNeedsReload(failure));
        setReview(true);
      }
    } finally {
      if (alive.current && admitted()) {
        lock.current = false;
        setPending(false);
        onPending(false);
      }
    }
  }
  start.current = prepare;
  useEffect(
    /** Register invalidation before admitting the initial preview. */ () => {
      alive.current = true;
      let unlisten: (() => void) | undefined;
      void onCalendarChanged(
        /** Revoke reviewed impact on relevant committed changes. */ (change) => {
          if (
            !alive.current ||
            !admitted() ||
            (change.eventId !== null && change.eventId !== event.id)
          )
            return;
          sequence.current++;
          request.current = null;
          setPreview(null);
          setReview(true);
        },
      )
        .then(
          /** Close a late subscription or begin the initial review. */ (cleanup) => {
            if (!alive.current) cleanup();
            else {
              unlisten = cleanup;
              void start.current?.();
            }
          },
        )
        .catch(
          /** Keep confirmation recovery explicit when updates cannot be observed. */ () => {
            if (alive.current && admitted()) {
              setListenerError(true);
              void start.current?.();
            }
          },
        );
      return /** Retire preview work and release its native listener. */ () => {
        alive.current = false;
        sequence.current++;
        try {
          unlisten?.();
        } catch {
          /* A retired owner cannot publish cleanup failures. */
        }
      };
    },
    [admitted, event.id],
  );
  useEffect(
    /** Expire only the visible authorization, leaving renewal to the user. */ () => {
      if (!preview) return;
      const timer = setTimeout(
        /** Require a fresh review after the backend TTL window. */ () => {
          if (alive.current && admitted()) invalidate();
        },
        Math.max(0, expires.current - Date.now()),
      );
      return /** Release the previous preview expiry timer. */ () => clearTimeout(timer);
    },
    [preview, admitted, invalidate],
  );
  /** Consume one reviewed token without retrying an uncertain destructive result. */
  async function confirm() {
    if (!alive.current || !admitted() || lock.current || blocked || !request.current) return;
    if (Date.now() >= expires.current) {
      invalidate();
      return;
    }
    const input = { requestId: request.current.requestId };
    const ticket = ++sequence.current;
    lock.current = true;
    setPending(true);
    onPending(true);
    setError(null);
    try {
      await confirmDeleteCalendarEvent(input);
      // Invalidation may arrive before acknowledgement; it revokes tokens, not this committed result.
      if (alive.current && admitted()) onDeleted();
    } catch (failure) {
      if (alive.current && admitted()) {
        setError(failure);
        setBlocked(eventNeedsReload(failure));
        invalidate();
      }
    } finally {
      if (alive.current && admitted()) {
        if (sequence.current === ticket) sequence.current++;
        lock.current = false;
        setPending(false);
        onPending(false);
      }
    }
  }
  return (
    <div className="space-y-3" aria-busy={pending}>
      <p>Delete Event: {preview?.title ?? event.title}</p>
      <p>
        {event.recurrence.kind !== "none"
          ? "This deletes the entire series."
          : "This deletes the entire event."}
      </p>
      {preview && <p>{preview.reminderCount} reminder definitions will be deleted.</p>}
      {pending && <p role="status">{preview ? "Deleting event…" : "Preparing deletion…"}</p>}
      {listenerError && (
        <p role="alert">
          Calendar updates are unavailable. The backend will verify the preview before deleting.
        </p>
      )}
      {error != null && <p role="alert">{eventMutationCopy(error)}</p>}
      {review && !blocked && (
        <Button type="button" disabled={pending} onClick={prepare}>
          Review deletion again
        </Button>
      )}
      {blocked && (
        <Button
          type="button"
          disabled={pending}
          onClick={
            /** Leave uncertain deletion and read authoritative state. */ () => {
              if (alive.current && admitted() && !lock.current) onReload();
            }
          }
        >
          Reload
        </Button>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={
            /** Cancel without sending the confirmation command. */ () => {
              if (alive.current && admitted() && !lock.current) onCancel();
            }
          }
        >
          Cancel
        </Button>
        <Button type="button" disabled={pending || blocked || !preview} onClick={confirm}>
          Delete Event
        </Button>
      </div>
    </div>
  );
}
