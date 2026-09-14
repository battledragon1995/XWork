import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatByteSize, formatLineCount, formatLineEnding } from "./file-facts";
import type { FileHandleEntry, FileHandleEntryState } from "./file-handle-registry";
import { MarkdownConflictDialog } from "./markdown-conflict-dialog";
import { createMarkdownEditor, type MarkdownEditorAdapter } from "./markdown-editor-adapter";

/** Host the retained Markdown editor and its explicit preview/conflict actions. */
export function MarkdownEditor(props: {
  entry: FileHandleEntry;
  state: FileHandleEntryState;
  region: "header" | "body";
  active: boolean;
  visible: boolean;
  platform?: string;
  createAdapter?: typeof createMarkdownEditor;
  onOpenProject?(): void;
  onActivate?(): void;
  isSuspended?(): boolean;
}) {
  const { entry, state } = props;
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<MarkdownEditorAdapter | null>(null);
  const composing = useRef(false);
  const pendingSave = useRef(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [Preview, setPreview] = useState<
    typeof import("./markdown-preview").MarkdownPreview | null
  >(null);
  const [loadFailure, setLoadFailure] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry intentionally starts a new chunk request.
  useEffect(() => {
    if (props.region !== "body" || state.markdownMode !== "preview" || Preview !== null) return;
    let alive = true;
    import("./markdown-preview")
      .then((module) => {
        if (alive) setPreview(() => module.MarkdownPreview);
      })
      .catch(() => {
        if (alive) setLoadFailure(true);
      });
    return () => {
      alive = false;
    };
  }, [props.region, state.markdownMode, Preview, loadAttempt]);
  /** Save errors are published by the registry and never become unhandled rejections. */
  const save = () => {
    if (composing.current) {
      pendingSave.current = true;
      return;
    }
    if (!state.admissionBlocked && !props.isSuspended?.())
      void entry.saveMarkdown().catch(() => undefined);
  };
  useEffect(() => {
    if (props.region !== "body" || state.markdownMode !== "edit" || !props.visible || !host.current)
      return;
    const view = (props.createAdapter ?? createMarkdownEditor)({
      parent: host.current,
      text: entry.getSnapshot().draft ?? "",
      name: entry.getSnapshot().handle?.name ?? "Markdown",
      state: entry.readEditorState(),
      scrollTop: entry.readScrollTop(),
      /** Publish the transaction before accepting it into the view. */
      accept: (text) => {
        if (props.isSuspended?.()) return false;
        entry.setMarkdownText(text);
        return entry.getSnapshot().draft === text;
      },
      /** Retain immutable state after each accepted transaction. */
      onState: (value) => entry.writeEditorState(value),
    });
    adapter.current = view;
    /** Preserve history and scroll when Edit unmounts or the route changes. */
    return () => {
      entry.writeEditorState(view.readState());
      entry.writeScrollTop(view.readScrollTop());
      view.destroy();
      adapter.current = null;
    };
  }, [
    entry,
    props.region,
    props.visible,
    props.createAdapter,
    props.isSuspended,
    state.markdownMode,
  ]);
  useEffect(() => {
    adapter.current?.setText(state.draft ?? "");
    adapter.current?.setBlocked(state.admissionBlocked);
  }, [state.draft, state.admissionBlocked]);
  const unavailable =
    state.handle?.state.kind !== "ready" ||
    state.failureCode === "fileHandleNotFound" ||
    state.failureCode === "invalidFileHandleId";
  /** Scope the fixed save shortcut to this active pane's own descendants. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.key.toLowerCase() === "s" &&
      (props.platform === "macos" ? event.metaKey : event.ctrlKey) &&
      props.active &&
      props.visible &&
      !event.altKey &&
      !(event.target instanceof Element && event.target.closest('[role="dialog"]'))
    ) {
      event.preventDefault();
      if (!state.isSaving && !unavailable) save();
    }
  };
  if (props.region === "header")
    return (
      <div
        onFocus={props.onActivate}
        role="toolbar"
        aria-label="Markdown controls"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 truncate" title={state.handle?.relativePath}>
          {state.handle?.relativePath}
        </span>
        <fieldset className="flex shrink-0 rounded bg-on-dark/10" aria-label="Markdown mode">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-on-dark hover:bg-on-dark/10 aria-pressed:bg-on-dark/15"
            aria-pressed={state.markdownMode === "edit"}
            onClick={() => entry.setMarkdownMode("edit")}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-on-dark hover:bg-on-dark/10 aria-pressed:bg-on-dark/15"
            aria-pressed={state.markdownMode === "preview"}
            onClick={() => entry.setMarkdownMode("preview")}
          >
            Preview
          </Button>
        </fieldset>
        {state.isDirty && <span className="text-warn-ink">Unsaved changes</span>}
        <Button
          size="sm"
          disabled={!state.isDirty || state.isSaving || state.admissionBlocked || unavailable}
          onClick={save}
        >
          {state.isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    );
  return (
    <section
      onFocus={props.onActivate}
      aria-label="Markdown document"
      className="flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composing.current = true;
        entry.setComposition(true, () => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && host.current?.contains(focused)) focused.blur();
        });
      }}
      onCompositionEnd={() => {
        composing.current = false;
        entry.setComposition(false);
        if (pendingSave.current) {
          pendingSave.current = false;
          save();
        }
      }}
    >
      {state.failure && (
        <p role="alert" className="p-2 text-error">
          {state.failure}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void entry.flushMarkdown().catch(() => undefined)}
          >
            Retry
          </Button>
        </p>
      )}
      {unavailable && (
        <p role="alert" className="p-2">
          {state.handle?.state.kind === "externalConflict"
            ? "This file changed on disk."
            : "The file is unavailable. Your draft is retained."}
          {state.handle?.state.kind !== "externalConflict" && (
            <Button variant="outline" onClick={() => void entry.reload()}>
              Retry
            </Button>
          )}
          {state.handle?.state.kind === "projectRootChanged" && (
            <Button variant="outline" onClick={props.onOpenProject}>
              Open project
            </Button>
          )}
          {state.handle?.state.kind === "externalConflict" && (
            <Button variant="outline" onClick={() => setConflictOpen(true)}>
              Resolve conflict
            </Button>
          )}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.markdownMode === "edit" ? (
          <div ref={host} className="h-full" />
        ) : Preview === null ? (
          loadFailure ? (
            <p role="alert">
              Could not load preview.{" "}
              <Button
                onClick={() => {
                  setLoadFailure(false);
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                Retry
              </Button>
            </p>
          ) : (
            <p role="status" aria-busy="true">
              Loading preview…
            </p>
          )
        ) : (
          <Preview
            text={state.draft ?? ""}
            initialScrollTop={entry.readPreviewScrollTop()}
            onScroll={(value) => entry.writePreviewScrollTop(value)}
            onEdit={() => entry.setMarkdownMode("edit")}
          />
        )}
      </div>
      <div className="flex gap-3 px-3 py-1 text-xs text-muted-soft">
        <span>{state.markdownFile?.hasUtf8Bom ? "UTF-8 with BOM" : "UTF-8"}</span>
        <span>{state.markdownFile && formatLineEnding(state.markdownFile.lineEnding)}</span>
        <span>{state.markdownFile && formatLineCount(state.markdownFile.lineCount)}</span>
        <span>{state.markdownFile && formatByteSize(state.markdownFile.byteSize)}</span>
        <span>{state.isDirty ? "Unsaved changes" : "Saved"}</span>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {state.announcement}
      </div>
      {state.handle && (
        <MarkdownConflictDialog
          handle={state.handle}
          open={conflictOpen}
          pending={state.isResolving}
          failure={state.failure}
          onClose={() => setConflictOpen(false)}
          onResolve={(resolution) => {
            void entry
              .resolveMarkdown(resolution)
              .then(() => setConflictOpen(false))
              .catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}
