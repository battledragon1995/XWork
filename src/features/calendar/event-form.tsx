import { useEffect, useId, useRef, useState } from "react";
import type { EventRecurrenceDto, EventRecurrenceEndDto } from "@/bindings/calendar";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import {
  startWeekday,
  WEEKDAYS,
  type EventFieldErrors,
  type EventFormDraft,
} from "./event-form-state";

interface Props {
  draft: EventFormDraft;
  errors: EventFieldErrors;
  disabled: boolean;
  saving: boolean;
  admitted(): boolean;
  onChange(draft: EventFormDraft): void;
  onSubmit(): void;
  onCancel(): void;
  onDelete?(): void;
}

/** Render the shared controlled definition editor without owning persistence. */
export function EventForm({
  draft,
  errors,
  disabled,
  saving,
  admitted,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
}: Props) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectStatus, setProjectStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(
    /** Load optional project metadata without replacing the selected value. */ () => {
      void retry;
      let retired = false;
      let sequence = 0;
      let unlisten: (() => void) | undefined;
      /** Keep picker responses within this form and live boundary. */
      function valid(ticket: number) {
        return !retired && sequence === ticket && admitted();
      }
      /** Read registered projects, including unavailable folders. */
      async function load() {
        if (!admitted()) return;
        const ticket = ++sequence;
        setProjectStatus("loading");
        try {
          const rows = await listProjects();
          if (valid(ticket)) {
            setProjects(rows);
            setProjectStatus("ready");
          }
        } catch {
          if (valid(ticket)) setProjectStatus("error");
        }
      }
      void load();
      void onProjectsChanged(
        /** Refresh choices without unlinking the draft. */ () => {
          void load();
        },
      )
        .then(
          /** Close subscriptions that arrive after retirement. */ (cleanup) => {
            if (retired) cleanup();
            else {
              unlisten = cleanup;
              void load();
            }
          },
        )
        .catch(
          /** Show retry when native updates cannot be registered. */ () => {
            if (!retired && admitted()) setProjectStatus("error");
          },
        );
      window.addEventListener("focus", load);
      return /** Retire metadata and release native listeners. */ () => {
        retired = true;
        sequence++;
        try {
          unlisten?.();
        } catch {
          /* Cleanup failure must not publish into a retired form. */
        }
        window.removeEventListener("focus", load);
      };
    },
    [admitted, retry],
  );
  useEffect(
    /** Focus the first invalid control after validation. */ () => {
      if (Object.keys(errors).length > 0)
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    },
    [errors],
  );
  /** Apply a single editable field only within a live unlocked owner. */
  function change<K extends keyof EventFormDraft>(key: K, value: EventFormDraft[K]) {
    if (!disabled && admitted()) onChange({ ...draft, [key]: value });
  }
  /** Render an accessible text or date control with its local field error. */
  function input(
    key: "title" | "startDate" | "endDate" | "startTime" | "endTime" | "timeZoneId",
    label: string,
    type = "text",
  ) {
    return (
      <label className="grid gap-1 text-sm" htmlFor={`${id}-${key}`}>
        {label}
        <input
          className="rounded border p-2"
          id={`${id}-${key}`}
          name={key}
          aria-label={label}
          type={type}
          value={draft[key]}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
          onChange={
            /** Keep raw input available for validation. */ (event) =>
              change(key, event.target.value)
          }
        />
        {errors[key] && <span id={`${id}-${key}-error`}>{errors[key]}</span>}
      </label>
    );
  }
  /** Update a recurrence end without adding fields to the none branch. */
  function setEnd(end: EventRecurrenceEndDto) {
    if (draft.recurrence.kind !== "none") change("recurrence", { ...draft.recurrence, end });
  }
  const recurrence = draft.recurrence;
  return (
    <form
      ref={form}
      noValidate
      aria-busy={saving}
      className="space-y-4"
      onCompositionStart={
        /** Prevent IME confirmation from submitting. */ () => {
          composing.current = true;
        }
      }
      onCompositionEnd={
        /** Restore normal form submission after composition. */ () => {
          composing.current = false;
        }
      }
      onKeyDown={
        /** Suppress native Enter submission while IME owns the key. */ (event) => {
          if (
            event.key === "Enter" &&
            (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }
      }
      onSubmit={
        /** Delegate a deliberate form submission to the mutation owner. */ (event) => {
          event.preventDefault();
          if (!composing.current && !disabled && admitted()) onSubmit();
        }
      }
    >
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="sr-only">Event definition</legend>
        {input("title", "Title")}
        <label className="grid gap-1" htmlFor={`${id}-description`}>
          Description
          <textarea
            className="rounded border p-2"
            id={`${id}-description`}
            aria-label="Description"
            value={draft.description}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? `${id}-description-error` : undefined}
            onChange={
              /** Preserve plain-text description input. */ (event) =>
                change("description", event.target.value)
            }
          />
          {errors.description && <span id={`${id}-description-error`}>{errors.description}</span>}
        </label>
        <label className="grid gap-1" htmlFor={`${id}-project`}>
          Project
          <select
            id={`${id}-project`}
            aria-label="Project"
            className="rounded border p-2"
            value={draft.projectId ?? ""}
            aria-invalid={!!errors.projectId}
            aria-describedby={errors.projectId ? `${id}-project-error` : undefined}
            onChange={
              /** Explicitly select or unlink a project. */ (event) =>
                change("projectId", event.target.value || null)
            }
          >
            <option value="">None</option>
            {draft.projectId &&
              !projects.some(
                /** Retain an unavailable selected link until the user changes it. */ (project) =>
                  project.id === draft.projectId,
              ) && <option value={draft.projectId}>Current project ({draft.projectId})</option>}
            {projects.map(
              /** Show registered project names. */ (project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ),
            )}
          </select>
          {errors.projectId && <span id={`${id}-project-error`}>{errors.projectId}</span>}
        </label>
        {projectStatus === "loading" && <p role="status">Loading projects…</p>}
        {projectStatus === "ready" && projects.length === 0 && <p>No projects available</p>}
        {projectStatus === "error" && (
          <div role="alert">
            Could not load projects. Your selection is preserved.{" "}
            <Button
              type="button"
              variant="outline"
              onClick={
                /** Retry choices without discarding draft input. */ () =>
                  setRetry(/** Advance the picker read lifetime. */ (value) => value + 1)
              }
            >
              Retry projects
            </Button>
          </div>
        )}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={
              /** Retain date and cached timed values when toggling branches. */ (event) =>
                change("allDay", event.target.checked)
            }
          />
          All day
        </label>
        <div className="grid grid-cols-2 gap-3">
          {input("startDate", "Starts", "date")}
          {input("endDate", draft.allDay ? "Last day" : "Ends", "date")}
          {!draft.allDay && (
            <>
              {input("startTime", "Start time", "time")}
              {input("endTime", "End time", "time")}
            </>
          )}
        </div>
        {input("timeZoneId", "Time zone")}
        <p className="text-xs text-muted">
          Changing the time zone keeps these wall times. Daylight saving time is checked when
          saving.
        </p>
        <fieldset className="space-y-2">
          <legend>Repeat</legend>
          <select
            aria-label="Repeat"
            aria-invalid={!!errors.recurrence}
            aria-describedby={errors.recurrence ? `${id}-recurrence-error` : undefined}
            value={recurrence.kind}
            onChange={
              /** Initialize only the fields required by the selected recurrence branch. */ (
                event,
              ) => {
                const kind = event.target.value as EventRecurrenceDto["kind"];
                change(
                  "recurrence",
                  kind === "none"
                    ? { kind }
                    : kind === "weekly"
                      ? { kind, weekdays: [startWeekday(draft.startDate)], end: { kind: "never" } }
                      : { kind, end: { kind: "never" } },
                );
              }
            }
          >
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          {recurrence.kind === "weekly" && (
            <fieldset className="flex flex-wrap gap-2">
              <legend>Weekdays</legend>
              {WEEKDAYS.map(
                /** Render each selectable Gregorian weekday. */ (weekday) => (
                  <label key={weekday}>
                    <input
                      type="checkbox"
                      checked={recurrence.weekdays.includes(weekday)}
                      onChange={
                        /** Change only the explicit weekday selection. */ (event) =>
                          change("recurrence", {
                            ...recurrence,
                            weekdays: event.target.checked
                              ? [...recurrence.weekdays, weekday]
                              : recurrence.weekdays.filter(
                                  /** Remove the unchecked weekday. */ (day) => day !== weekday,
                                ),
                          })
                      }
                    />
                    {weekday[0].toUpperCase() + weekday.slice(1)}
                  </label>
                ),
              )}
            </fieldset>
          )}
          {recurrence.kind !== "none" && (
            <>
              <label>
                Repeat ends{" "}
                <select
                  value={recurrence.end.kind}
                  onChange={
                    /** Initialize the selected end mode. */ (event) =>
                      setEnd(
                        event.target.value === "never"
                          ? { kind: "never" }
                          : event.target.value === "on_date"
                            ? { kind: "on_date", date: draft.startDate }
                            : { kind: "after_count", count: 1 },
                      )
                  }
                >
                  <option value="never">Never</option>
                  <option value="on_date">On date</option>
                  <option value="after_count">After count</option>
                </select>
              </label>
              {recurrence.end.kind === "on_date" && (
                <label>
                  Repeat end date
                  <input
                    type="date"
                    value={recurrence.end.date}
                    onChange={
                      /** Keep the inclusive recurrence end date. */ (event) =>
                        setEnd({ kind: "on_date", date: event.target.value })
                    }
                  />
                </label>
              )}
              {recurrence.end.kind === "after_count" && (
                <label>
                  Occurrence count
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={Number.isNaN(recurrence.end.count) ? "" : recurrence.end.count}
                    onChange={
                      /** Preserve empty numeric input as invalid until corrected. */ (event) =>
                        setEnd({
                          kind: "after_count",
                          count: event.target.value === "" ? NaN : Number(event.target.value),
                        })
                    }
                  />
                </label>
              )}
            </>
          )}
          {errors.recurrence && <p id={`${id}-recurrence-error`}>{errors.recurrence}</p>}
          {(recurrence.kind === "monthly" || recurrence.kind === "yearly") && (
            <p className="text-xs">
              Dates that do not exist are skipped. Count includes only valid occurrences.
            </p>
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend>Reminders</legend>
          {draft.reminderMinutes.length === 0 && <p>No reminders</p>}
          {draft.reminderMinutes.map(
            /** Render a temporary offset row without persisted reminder identity. */ (
              minutes,
              index,
            ) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Controlled positional rows have no local state or persisted identity.
              <div key={index} className="flex flex-wrap gap-2">
                <label>
                  Reminder {index + 1} preset
                  <select
                    value={
                      ["0", "5", "10", "30", "60", "1440"].includes(minutes) ? minutes : "custom"
                    }
                    onChange={
                      /** Apply a preset or leave the custom value editable. */ (event) => {
                        if (event.target.value !== "custom")
                          change(
                            "reminderMinutes",
                            draft.reminderMinutes.map(
                              /** Replace only this row. */ (value, row) =>
                                row === index ? event.target.value : value,
                            ),
                          );
                      }
                    }
                  >
                    <option value="0">At start</option>
                    <option value="5">5 minutes</option>
                    <option value="10">10 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="1440">1 day</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label>
                  Reminder {index + 1} minutes
                  <input
                    className="w-28 rounded border p-1"
                    type="number"
                    min={0}
                    max={525600}
                    value={minutes}
                    aria-invalid={!!errors.reminderMinutes}
                    aria-describedby={errors.reminderMinutes ? `${id}-reminders-error` : undefined}
                    onChange={
                      /** Preserve raw custom minute input. */ (event) =>
                        change(
                          "reminderMinutes",
                          draft.reminderMinutes.map(
                            /** Replace this offset only. */ (value, row) =>
                              row === index ? event.target.value : value,
                          ),
                        )
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Remove reminder ${index + 1}`}
                  onClick={
                    /** Remove one definition without delivery side effects. */ () =>
                      change(
                        "reminderMinutes",
                        draft.reminderMinutes.filter(
                          /** Keep other temporary rows. */ (_, row) => row !== index,
                        ),
                      )
                  }
                >
                  Remove
                </Button>
              </div>
            ),
          )}
          {errors.reminderMinutes && <p id={`${id}-reminders-error`}>{errors.reminderMinutes}</p>}
          <Button
            type="button"
            variant="outline"
            disabled={draft.reminderMinutes.length >= 16}
            onClick={
              /** Add an editable offset for explicit validation. */ () =>
                change("reminderMinutes", [...draft.reminderMinutes, "10"])
            }
          >
            Add reminder
          </Button>
        </fieldset>
      </fieldset>
      <p className="text-xs text-muted">
        Unsaved event changes are discarded when quitting or replacing app data.
      </p>
      {saving && <p role="status">Saving event…</p>}
      <div className="flex justify-end gap-2">
        {onDelete && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="mr-auto"
            onClick={onDelete}
          >
            Delete Event
          </Button>
        )}
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={disabled}>
          Save event
        </Button>
      </div>
    </form>
  );
}
