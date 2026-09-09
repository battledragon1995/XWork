import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { CalendarEventDto, CalendarOccurrenceDto } from "@/bindings/calendar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getCalendarEvent, onCalendarChanged, updateCalendarEvent } from "@/lib/ipc/calendar";
import { getProject, onProjectsChanged } from "@/lib/ipc/projects";
import {
  calendarErrorCopy,
  calendarErrorKind,
  eventFieldErrors,
  eventMutationCopy,
  eventNeedsReload,
} from "./calendar-error-copy";
import {
  addDays,
  occurrenceLabel,
  recurrenceSummary,
  reminderSummary,
} from "./calendar-presentation";
import { EventForm } from "./event-form";
import { EventDeleteDialog } from "./event-delete-dialog";
import {
  eventDraft,
  eventInput,
  validateEventDraft,
  type EventFieldErrors,
  type EventFormDraft,
} from "./event-form-state";
import type { CalendarBoundary } from "./use-calendar-query";

interface Props {
  eventId: string;
  occurrence: CalendarOccurrenceDto | null;
  zone: string;
  boundary: CalendarBoundary;
  readBoundary?(): CalendarBoundary;
  onClose(): void;
  onChanged(): void;
  restoreFocus(): void;
}
interface Editor {
  source: CalendarEventDto;
  draft: EventFormDraft;
  errors: EventFieldErrors;
  error: unknown;
  blocked: boolean;
}
type Action = "close" | "view" | "delete" | "reload";

/** Own authoritative reads, revision-safe edits and confirmed deletion in one modal. */
export function EventDetailPanel({
  eventId,
  occurrence,
  zone,
  boundary,
  readBoundary,
  onClose,
  onChanged,
  restoreFocus,
}: Props) {
  const [state, setState] = useState<{
    event: CalendarEventDto | null;
    error: unknown;
    project: { id: string; name: string } | null;
    loading: boolean;
    context: CalendarOccurrenceDto | null;
  }>({ event: null, error: null, project: null, loading: true, context: occurrence });
  const [editor, setEditor] = useState<Editor | null>(null);
  const edit = useRef<Editor | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [discard, setDiscard] = useState<Action | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const mutationEpoch = useRef(0);
  const alive = useRef(true);
  const identity = `${eventId}:${boundary.epoch}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [retry, setRetry] = useState(0);
  const [listenerError, setListenerError] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const userClosed = useRef(false);
  const admitted = useCallback(
    /** Deny responses and interactions across selection or operation boundaries. */ () => {
      const live = readBoundary?.() ?? { epoch: boundary.epoch, suspended: boundary.suspended };
      return (
        alive.current &&
        currentIdentity.current === identity &&
        !live.suspended &&
        live.epoch === boundary.epoch
      );
    },
    [identity, readBoundary, boundary.epoch, boundary.suspended],
  );
  /** Publish temporary editor state and its synchronous read mirror together. */
  const publishEditor = useCallback(
    /** Synchronize async read access with the rendered draft. */ (value: Editor | null) => {
      edit.current = value;
      setEditor(value);
    },
    [],
  );
  useEffect(
    /** Retire mutation callbacks after unmount. */ () => {
      alive.current = true;
      return /** Prevent callbacks after the dialog is gone. */ () => {
        alive.current = false;
      };
    },
    [],
  );
  useEffect(
    /** Reset modes when a mounted owner receives a replacement selection. */ () => {
      void identity;
      publishEditor(null);
      setMode("view");
      setDiscard(null);
      lock.current = false;
      setSaving(false);
    },
    [identity, publishEditor],
  );
  useEffect(
    /** Bound event details and project labels to this selection and read epoch. */ () => {
      let retired = false;
      let sequence = 0;
      const unlisteners: (() => void)[] = [];
      /** Check synchronous admission before publishing native responses. */
      function valid(ticket: number) {
        return !retired && sequence === ticket && admitted();
      }
      /** Revalidate revision without replacing an active manual draft. */
      async function load(invalidated = false) {
        if (!admitted() || lock.current) return;
        const ticket = ++sequence;
        const generation = mutationEpoch.current;
        if (!edit.current)
          setState(
            /** Keep the visible definition while refreshing. */ (previous) => ({
              ...previous,
              error: null,
              loading: true,
              context: invalidated ? null : occurrence,
            }),
          );
        try {
          const event = await getCalendarEvent(eventId);
          if (!valid(ticket) || lock.current || generation !== mutationEpoch.current) return;
          const active = edit.current;
          if (active && event.revision !== active.source.revision)
            publishEditor({ ...active, blocked: true, error: { stale: true } });
          setState({
            event,
            error: null,
            project: null,
            loading: false,
            context: invalidated ? null : occurrence,
          });
          if (event.projectId) {
            try {
              const project = await getProject(event.projectId);
              if (valid(ticket) && generation === mutationEpoch.current)
                setState(
                  /** Attach only the still-current project label. */ (previous) => ({
                    ...previous,
                    project: { id: project.id, name: project.displayName },
                  }),
                );
            } catch {
              /* Event reads do not depend on project folder availability. */
            }
          }
        } catch (error) {
          if (!valid(ticket) || lock.current || generation !== mutationEpoch.current) return;
          const active = edit.current;
          if (active)
            publishEditor({
              ...active,
              error,
              blocked: active.blocked || calendarErrorKind(error) === "event_not_found",
            });
          else setState({ event: null, error, project: null, loading: false, context: null });
          if (calendarErrorKind(error) === "event_not_found") onChanged();
        }
      }
      /** Refresh visible queries and revalidate only while the live boundary permits it. */
      function changed() {
        if (admitted() && !retired) {
          onChanged();
          void load(true);
        }
      }
      setListenerError(false);
      for (const subscribe of [onCalendarChanged, onProjectsChanged]) {
        void subscribe(changed)
          .then(
            /** Close late subscriptions or cover their setup race. */ (unlisten) => {
              if (retired) unlisten();
              else {
                unlisteners.push(unlisten);
                void load(true);
              }
            },
          )
          .catch(
            /** Keep listener failure recoverable without publishing after retirement. */ () => {
              if (!retired && admitted()) setListenerError(true);
            },
          );
      }
      void load(retry > 0);
      window.addEventListener("focus", changed);
      return /** Retire read work before attempting all listener cleanups. */ () => {
        retired = true;
        sequence++;
        for (const unlisten of unlisteners) {
          try {
            unlisten();
          } catch {
            /* Continue releasing the other subscriptions. */
          }
        }
        window.removeEventListener("focus", changed);
      };
    },
    [eventId, occurrence, admitted, retry, onChanged, publishEditor],
  );
  /** Complete an explicitly admitted close, discard, deletion or reload action. */
  function perform(action: Action) {
    if (!admitted() || lock.current) return;
    setDiscard(null);
    publishEditor(null);
    if (action === "close") {
      userClosed.current = true;
      onClose();
    } else if (action === "delete") setMode("delete");
    else {
      setMode("view");
      if (action === "reload")
        setRetry(/** Re-read after uncertain or stale edits. */ (value) => value + 1);
    }
  }
  /** Ask before abandoning dirty manual input. */
  function request(action: Action) {
    if (!admitted() || lock.current) return;
    const active = edit.current;
    if (active && JSON.stringify(active.draft) !== JSON.stringify(eventDraft(active.source)))
      setDiscard(action);
    else perform(action);
  }
  /** Freeze the base definition and revision when entering edit mode. */
  function beginEdit() {
    if (!admitted() || lock.current || !state.event || state.loading) return;
    publishEditor({
      source: state.event,
      draft: eventDraft(state.event),
      errors: {},
      error: null,
      blocked: false,
    });
    setMode("edit");
  }
  useEffect(
    /** Move focus into the newly mounted editor. */ () => {
      if (mode === "edit" && admitted())
        content.current?.querySelector<HTMLInputElement>('[name="title"]')?.focus();
    },
    [mode, admitted],
  );
  /** Submit the original opaque revision once and publish only its committed acknowledgement. */
  async function save() {
    const active = edit.current;
    if (!admitted() || lock.current || !active || active.blocked) return;
    const errors = validateEventDraft(active.draft);
    publishEditor({ ...active, errors });
    if (Object.keys(errors).length) return;
    lock.current = true;
    mutationEpoch.current++;
    setSaving(true);
    try {
      const result = await updateCalendarEvent({
        eventId: active.source.id,
        expectedRevision: active.source.revision,
        event: eventInput(active.draft),
      });
      if (!admitted()) return;
      publishEditor(null);
      setMode("view");
      setState(
        /** Replace detail using committed data, dropping occurrence context. */ (previous) => ({
          ...previous,
          event: result,
          project: previous.project?.id === result.projectId ? previous.project : null,
          context: null,
          error: null,
          loading: false,
        }),
      );
      onChanged();
    } catch (error) {
      if (admitted())
        publishEditor({
          ...active,
          error,
          errors: eventFieldErrors(error),
          blocked: eventNeedsReload(error),
        });
    } finally {
      if (admitted()) {
        lock.current = false;
        setSaving(false);
      }
    }
  }
  const event = state.event;
  return (
    <Dialog
      open={!boundary.suspended}
      onOpenChange={
        /** Close through the current pending and dirty safeguards. */ (open) => {
          if (!open) request("close");
        }
      }
    >
      <DialogContent
        ref={content}
        showCloseButton={!saving}
        className={
          mode === "edit"
            ? "top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none sm:max-w-[560px]"
            : "max-h-[85vh] overflow-y-auto"
        }
        onCloseAutoFocus={
          /** Restore focus only for the current live selection. */ (event) => {
            event.preventDefault();
            const live = readBoundary?.() ?? boundary;
            if (
              userClosed.current &&
              currentIdentity.current === identity &&
              !live.suspended &&
              live.epoch === boundary.epoch
            )
              restoreFocus();
          }
        }
      >
        <DialogTitle>
          {mode === "edit"
            ? "Edit Event"
            : mode === "delete"
              ? "Delete Event"
              : (event?.title ?? "Event details")}
        </DialogTitle>
        <DialogDescription>
          {mode === "view" ? "Calendar event details" : "Changes apply to the entire series"}
        </DialogDescription>
        {discard ? (
          <div role="alertdialog" aria-label="Discard changes?" className="space-y-3">
            <p>Discard changes?</p>
            <Button type="button" onClick={/** Resume the intact editor. */ () => setDiscard(null)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={
                /** Carry out the previously requested action after confirmation. */ () =>
                  perform(discard)
              }
            >
              Discard changes
            </Button>
          </div>
        ) : mode === "edit" && editor ? (
          <>
            {editor.error != null && (
              <p role="alert">
                {typeof editor.error === "object" && "stale" in editor.error
                  ? "This event changed. Reload to edit the latest version."
                  : eventMutationCopy(editor.error)}
              </p>
            )}
            {editor.blocked && (
              <Button
                type="button"
                disabled={saving}
                onClick={
                  /** Explicitly abandon the obsolete revision before re-reading. */ () =>
                    request("reload")
                }
              >
                Reload
              </Button>
            )}
            <EventForm
              draft={editor.draft}
              errors={editor.errors}
              disabled={saving || editor.blocked}
              saving={saving}
              admitted={admitted}
              onChange={
                /** Keep source revision separate from temporary edits. */ (draft) => {
                  if (edit.current) publishEditor({ ...edit.current, draft, errors: {} });
                }
              }
              onSubmit={save}
              onCancel={/** Return to detail after checking dirty input. */ () => request("view")}
              onDelete={
                /** Discard a dirty draft before previewing whole-series deletion. */ () =>
                  request("delete")
              }
            />
          </>
        ) : mode === "delete" && event ? (
          <EventDeleteDialog
            event={event}
            admitted={admitted}
            onPending={
              /** Keep the surrounding modal locked throughout prepare and confirm. */ (
                pending,
              ) => {
                if (pending) mutationEpoch.current++;
                lock.current = pending;
                setSaving(pending);
              }
            }
            onCancel={
              /** Return to the current clean detail. */ () => {
                if (admitted()) setMode("view");
              }
            }
            onReload={
              /** Clear an uncertain preview and re-read the definition. */ () => perform("reload")
            }
            onDeleted={
              /** Refresh local reads even if the native change event was lost. */ () => {
                if (admitted()) {
                  onChanged();
                  userClosed.current = true;
                  onClose();
                }
              }
            }
          />
        ) : (
          <>
            {state.loading && <p role="status">Loading event…</p>}
            {state.error != null && <p role="alert">{calendarErrorCopy(state.error)}</p>}
            {state.error != null && (
              <Button
                type="button"
                variant="outline"
                onClick={
                  /** Retry reads and subscriptions within the live boundary. */ () => {
                    if (admitted())
                      setRetry(
                        /** Advance the authoritative read lifetime. */ (value) => value + 1,
                      );
                  }
                }
              >
                Retry
              </Button>
            )}
            {event && (
              <div className="space-y-3 break-words text-sm">
                {state.context && (
                  <p>Selected occurrence: {occurrenceLabel(state.context, zone)}</p>
                )}
                <p>
                  Base schedule:{" "}
                  {event.time.kind === "all_day"
                    ? `${event.time.startDate} – ${addDays(event.time.endDateExclusive, -1)}, all day`
                    : `${event.time.startLocal} – ${event.time.endLocal}`}
                </p>
                <p>Time zone: {event.time.timeZoneId}</p>
                <p className="whitespace-pre-wrap">{event.description || "No description"}</p>
                <p>{recurrenceSummary(event.recurrence)}</p>
                <p>{reminderSummary(event.reminders)}</p>
                {state.project && (
                  <Link
                    to={`/projects/${encodeURIComponent(state.project.id)}`}
                    onClick={
                      /** Block navigation after synchronous lifecycle retirement. */ (event) => {
                        if (!admitted()) event.preventDefault();
                      }
                    }
                  >
                    Project: {state.project.name}
                  </Link>
                )}
                <div className="flex gap-2">
                  <Button type="button" disabled={state.loading} onClick={beginEdit}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={state.loading}
                    onClick={
                      /** Review whole-event deletion before confirmation. */ () =>
                        request("delete")
                    }
                  >
                    Delete Event
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {listenerError && (
          <div role="alert">
            <p>Calendar updates are unavailable</p>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={
                /** Retry failed subscriptions without discarding the draft. */ () => {
                  if (admitted() && !lock.current)
                    setRetry(/** Restart listener setup. */ (value) => value + 1);
                }
              }
            >
              Retry
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
