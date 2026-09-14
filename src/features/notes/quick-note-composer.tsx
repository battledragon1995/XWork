import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useNoteProjects } from "./note-actions";
import { useNotes } from "./notes-provider";

/** Render the manually saved Quick Note form in an app-owned Home slot. */
export function QuickNoteComposer({
  suspended,
  readSuspended,
}: {
  suspended: boolean;
  readSuspended(): boolean;
}): React.JSX.Element {
  const { owner, quickNote: draft, blocked } = useNotes();
  const { projects, error, loading } = useNoteProjects(suspended || blocked);
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [invalid, setInvalid] = useState<{ title?: string; body?: string }>({});
  // A replaced app-data lifetime also retires local validation feedback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity represents explicit retirement.
  useEffect(
    /** Clear field errors after Cancel, acknowledgement, or maintenance. */ () => {
      setInvalid({});
    },
    [draft.identity],
  );
  const saving = draft.phase === "saving";
  const disabled = suspended || blocked || saving;
  const uncertain = draft.phase === "uncertain";
  const inputClass =
    "w-full min-w-0 border-0 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-soft focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
  /** Validate only on explicit Save and leave normalization to Rust. */
  async function save() {
    if (disabled || readSuspended() || uncertain || composing.current) return;
    owner.editQuickNote({});
    const errors: typeof invalid = {};
    if (
      Array.from(draft.title.trim()).length > 255 ||
      Array.from(draft.title).some(
        /** Reject C0 and C1 controls before the backend boundary. */ (char) => {
          const point = char.codePointAt(0) ?? 0;
          return point < 32 || (point >= 127 && point <= 159);
        },
      )
    )
      errors.title = "Use at most 255 characters without control characters.";
    if (!draft.contentMarkdown.trim()) errors.body = "Write a note before saving.";
    else if (new TextEncoder().encode(draft.contentMarkdown).length > 1048576)
      errors.body = "Keep Markdown within 1 MiB.";
    setInvalid(errors);
    if (errors.title || errors.body) {
      (errors.title ? title : body).current?.focus();
      return;
    }
    await owner.saveQuickNote();
    // Only the still-mounted composer that retains focus may move it after acknowledgement.
    if (owner.state.quickNote.phase === "saved" && root.current?.contains(document.activeElement))
      body.current?.focus();
  }
  /** Discard local input and preserve the user's current navigation focus. */
  function cancel() {
    if (disabled || readSuspended()) return;
    const focused = root.current?.contains(document.activeElement);
    owner.cancelQuickNote();
    setInvalid({});
    if (focused) body.current?.focus();
  }
  return (
    <div
      ref={root}
      className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-canvas"
      aria-busy={saving}
    >
      <h2 className="sr-only">Quick Note</h2>
      <label className="block pt-2" htmlFor={`${prefix}-title`}>
        <span className="sr-only">Title (optional)</span>
        <input
          id={`${prefix}-title`}
          ref={title}
          className={`${inputClass} font-display text-[22px] font-medium text-ink`}
          placeholder="Title (optional)"
          value={draft.title}
          disabled={disabled}
          readOnly={uncertain}
          aria-invalid={Boolean(invalid.title)}
          aria-describedby={invalid.title ? `${prefix}-title-error` : undefined}
          onChange={
            /** Retain manual title without triggering autosave. */ (event) => {
              owner.editQuickNote({ title: event.target.value });
              setInvalid({});
            }
          }
          onCompositionStart={
            /** Block Save during IME composition. */ () => {
              composing.current = true;
            }
          }
          onCompositionEnd={
            /** Admit Save after committed IME text. */ () => {
              composing.current = false;
            }
          }
        />
      </label>
      {invalid.title && (
        <p id={`${prefix}-title-error`} role="alert" className="text-sm text-destructive">
          {invalid.title}
        </p>
      )}
      <label className="block" htmlFor={`${prefix}-body`}>
        <span className="sr-only">Markdown</span>
        <textarea
          id={`${prefix}-body`}
          ref={body}
          className={`${inputClass} block min-h-28 resize-y leading-relaxed`}
          placeholder="Write a note… Markdown works here."
          value={draft.contentMarkdown}
          disabled={disabled}
          readOnly={uncertain}
          aria-invalid={Boolean(invalid.body)}
          aria-describedby={invalid.body ? `${prefix}-body-error` : undefined}
          onChange={
            /** Preserve verbatim Markdown as manual input. */ (event) => {
              owner.editQuickNote({ contentMarkdown: event.target.value });
              setInvalid({});
            }
          }
          onCompositionStart={
            /** Block Save during body composition. */ () => {
              composing.current = true;
            }
          }
          onCompositionEnd={
            /** Release the IME gate after commit. */ () => {
              composing.current = false;
            }
          }
        />
      </label>
      {invalid.body && (
        <p id={`${prefix}-body-error`} role="alert" className="text-sm text-destructive">
          {invalid.body}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline-soft px-3 py-2">
        <label className="mr-auto min-w-0 max-w-44" htmlFor={`${prefix}-project`}>
          <span className="sr-only">Project</span>
          <select
            id={`${prefix}-project`}
            className="h-7 w-full rounded-sm border border-hairline bg-surface-soft px-2 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={draft.projectId ?? ""}
            disabled={disabled || uncertain}
            onChange={
              /** Keep the selected opaque project identity. */ (event) =>
                owner.editQuickNote({ projectId: event.target.value || null })
            }
          >
            <option value="">No project</option>
            {draft.projectId &&
              !projects.some(
                /** Preserve missing selection. */ (project) => project.id === draft.projectId,
              ) && <option value={draft.projectId}>Project unavailable</option>}
            {projects.map(
              /** Include registered unavailable projects. */ (project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ),
            )}
          </select>
        </label>
        {(draft.phase !== "empty" || invalid.title || invalid.body) && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || (draft.phase === "empty" && !invalid.title && !invalid.body)}
            onClick={cancel}
          >
            Cancel
          </Button>
        )}
        <Button type="button" disabled={disabled || uncertain} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      )}
      {error && (
        <div className="text-sm">
          <span role="alert">Could not load projects. </span>
          <Button type="button" variant="outline" onClick={owner.invalidate}>
            Refresh projects
          </Button>
        </div>
      )}
      {draft.message && (
        <p role="alert" className="text-sm text-destructive">
          {draft.message}
        </p>
      )}
      {uncertain && (
        <p className="text-sm">
          This only discards the local draft; a saved note may already exist.{" "}
          <Link className="underline" to="/notes">
            Open Notes
          </Link>
        </p>
      )}
      {draft.savedNote && (
        <p role="status" className="text-sm">
          Note saved.{" "}
          <Link
            className="underline"
            to={`/notes?noteId=${encodeURIComponent(draft.savedNote.id)}&view=active`}
          >
            Open note
          </Link>
        </p>
      )}
    </div>
  );
}
