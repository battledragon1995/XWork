import { useEffect, useRef } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { NoteActions } from "./note-actions";
import { createNoteEditorState, mountNoteEditor } from "./note-editor-adapter";
import { useNotes } from "./notes-provider";
/** Render the retained Notes draft without coupling its lifetime to route visibility. */
export function NoteEditor() {
  const { owner, draft, blocked, actionBusy } = useNotes();
  const host = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLElement>(null);
  const identity = draft?.identity;
  const readOnly = !!draft?.base && draft.base.status !== "active";
  const disabled = blocked || actionBusy;
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft identity and mode own the retained view lifetime.
  useEffect(
    /** Restore editor transactions across Preview and route unmounts. */ () => {
      if (!host.current || !owner.state.draft) return;
      const d = owner.state.draft;
      const state =
        owner.editorState ??
        createNoteEditorState(
          d.contentMarkdown,
          /** Store caret/history and admit document changes only once. */ (state) => {
            owner.editorState = state;
            if (state.doc.toString() !== owner.state.draft?.contentMarkdown)
              owner.edit({ contentMarkdown: state.doc.toString() });
          },
          /** Coordinate IME with the owner timer. */ (active) => owner.composition(active),
          readOnly,
        );
      const view = mountNoteEditor(host.current, state);
      view.scrollDOM.scrollTop = owner.editorScroll;
      if (!d.base) title.current?.focus();
      return () => {
        if (owner.state.draft?.identity === d.identity) {
          owner.editorState = view.state;
          owner.editorScroll = view.scrollDOM.scrollTop;
        }
        view.destroy();
      };
    },
    [owner, identity, readOnly],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft identity and mode own the retained view lifetime.
  useEffect(
    /** Restore preview scroll without changing editor history. */ () => {
      if (preview.current) preview.current.scrollTop = owner.previewScroll;
    },
    [owner, draft?.mode],
  );
  if (!draft) return <p className="p-8 text-muted">Select a note or create a new one</p>;
  return (
    <section
      aria-label="Note editor"
      className="flex min-h-96 min-w-0 flex-1 flex-col overflow-auto bg-canvas text-body lg:min-h-0"
    >
      <div className="mb-5 flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
        <div className="flex rounded-md bg-surface-card p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 aria-pressed:bg-canvas aria-pressed:shadow-sm"
            aria-pressed={draft.mode === "edit"}
            onClick={
              /** Change presentation without destroying the view. */ () =>
                owner.draft({ mode: "edit" })
            }
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 aria-pressed:bg-canvas aria-pressed:shadow-sm"
            aria-pressed={draft.mode === "preview"}
            onClick={
              /** Keep the editor mounted while showing preview. */ () =>
                owner.draft({ mode: "preview" })
            }
          >
            Preview
          </Button>
        </div>
        <span role="status" className="text-xs text-muted">
          {draft.phase === "saved"
            ? "Saved just now"
            : draft.phase === "saving"
              ? "Saving…"
              : draft.phase === "dirty"
                ? "Unsaved changes"
                : draft.base
                  ? "Not saved"
                  : "Draft"}
        </span>
        <div className="ml-auto">
          <NoteActions />
        </div>
      </div>
      {readOnly && (
        <p className="mx-6 mb-3 rounded border border-hairline p-3">
          {draft.base?.status === "trash" ? "This note is in Trash." : "This note is archived."}{" "}
          Read-only.
        </p>
      )}
      <input
        ref={title}
        aria-label="Note title"
        placeholder="Untitled note"
        value={draft.title}
        readOnly={readOnly || disabled}
        onCompositionStart={/** Suspend title autosave during IME. */ () => owner.composition(true)}
        onCompositionEnd={
          /** Resume after the title composition commits. */ () => owner.composition(false)
        }
        onChange={
          /** Admit the title into the retained draft. */ (event) =>
            owner.edit({ title: event.target.value })
        }
        className="mx-6 mb-4 w-auto shrink-0 bg-transparent font-display text-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {draft.message && (
        <div role="alert" className="my-3 space-y-2">
          <p>{draft.message}</p>
          {draft.phase === "conflict" ? (
            <>
              <Button
                disabled={disabled}
                onClick={
                  /** Explicitly discard conflicting local text. */ () => {
                    void owner.resolve(false);
                  }
                }
              >
                Use latest version
              </Button>
              <Button
                disabled={disabled || draft.conflict?.status !== "active"}
                onClick={
                  /** Explicitly save against the current revision. */ () => {
                    void owner.resolve(true).catch(/** Retain repeated conflict. */ () => {});
                  }
                }
              >
                Save my changes
              </Button>
            </>
          ) : draft.phase === "uncertain" && !draft.base ? (
            <>
              <Button onClick={owner.invalidate}>Refresh Notes</Button>
              <p>Creating another note may create a duplicate.</p>
              <Button
                disabled={disabled}
                onClick={
                  /** Retry creation only after explicit duplicate warning. */ () => {
                    void owner.createAnother().catch(/** Preserve uncertain outcome. */ () => {});
                  }
                }
              >
                Create another note
              </Button>
            </>
          ) : (
            <Button
              disabled={disabled}
              onClick={
                /** Retry the retained failure explicitly. */ () => {
                  void owner.retry().catch(/** Keep failure visible. */ () => {});
                }
              }
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {!draft.base && !draft.contentMarkdown.trim() && (
        <p className="px-6 text-sm text-muted">Add some content to save this note</p>
      )}
      <div
        inert={disabled}
        hidden={draft.mode !== "edit"}
        ref={host}
        className="min-h-64 flex-1 overflow-hidden px-6"
      />
      {draft.mode === "preview" && (
        <article
          ref={preview}
          onScroll={
            /** Retain the independent preview scroll. */ (event) => {
              owner.previewScroll = event.currentTarget.scrollTop;
            }
          }
          className="min-h-64 flex-1 overflow-auto px-6 leading-relaxed [&_h1]:font-display [&_h1]:text-2xl [&_h2]:font-display [&_h2]:text-xl [&_p]:mb-3 [&_pre]:overflow-auto [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
        >
          <MarkdownContent text={draft.contentMarkdown} />
        </article>
      )}
      {!draft.base && (
        <Button
          variant="outline"
          size="sm"
          className="mx-6 my-3 self-start"
          disabled={disabled || draft.phase === "saving"}
          onClick={owner.discard}
        >
          Discard draft
        </Button>
      )}
    </section>
  );
}
