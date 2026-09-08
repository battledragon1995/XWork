import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EditorState } from "@codemirror/state";
import type { ListNotesInputDto, NoteDto, NoteListPageDto, NotesError } from "@/bindings/notes";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/notes";
import { onProjectsChanged } from "@/lib/ipc/projects";
import { noteErrorCopy } from "./note-error-copy";

export interface NoteDraft {
  base: NoteDto | null;
  title: string;
  contentMarkdown: string;
  projectId: string | null;
  generation: number;
  acknowledgedGeneration: number;
  mode: "edit" | "preview";
  phase: "draft" | "dirty" | "saving" | "saved" | "error" | "conflict" | "uncertain";
  conflict: NoteDto | null;
  message: string | null;
  identity: number;
}
export interface QuickNoteState {
  title: string;
  contentMarkdown: string;
  projectId: string | null;
  phase: "empty" | "editing" | "saving" | "error" | "uncertain" | "saved";
  message: string | null;
  savedNote: NoteDto | null;
  identity: number;
}
/** Create an empty manual lifetime without touching the autosave editor. */
function emptyQuickNote(identity: number): QuickNoteState {
  return {
    title: "",
    contentMarkdown: "",
    projectId: null,
    phase: "empty",
    message: null,
    savedNote: null,
    identity,
  };
}
interface Snapshot {
  quickNote: QuickNoteState;
  draft: NoteDraft | null;
  epoch: number;
  blocked: boolean;
  actionBusy: boolean;
  listenerFailed: boolean;
}
/** Own one retained edit and serialize every backend write against its last acknowledgement. */
export class NotesOwner {
  state: Snapshot = {
    quickNote: emptyQuickNote(0),
    draft: null,
    epoch: 0,
    blocked: false,
    actionBusy: false,
    listenerFailed: false,
  };
  listeners = new Set<() => void>();
  timer: ReturnType<typeof setTimeout> | undefined;
  flight: Promise<void> | null = null;
  quickFlight: Promise<void> | null = null;
  actionFlight: Promise<void> | null = null;
  composing = false;
  serial = 0;
  selection = 0;
  editorState: EditorState | undefined;
  editorScroll = 0;
  previewScroll = 0;
  maintenanceNoteId: string | null = null;
  /** Return the stable external-store snapshot. */
  snapshot = () => this.state;
  /** Subscribe one React observer. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Publish immutable state before notifying consumers. */
  publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  /** Update only the retained draft. */
  draft(patch: Partial<NoteDraft>) {
    if (this.state.draft) this.publish({ draft: { ...this.state.draft, ...patch } });
  }
  /** Reset query generations and refresh a clean detail without replacing dirty text. */
  invalidate = () => {
    this.publish({ epoch: this.state.epoch + 1 });
    const d = this.state.draft;
    if (d?.base && !this.flight && !this.state.actionBusy && !this.state.blocked) {
      const epoch = this.state.epoch;
      void ipc
        .getNote(d.base.id)
        .then(
          /** Accept only the same clean lifetime. */ (base) => {
            if (this.state.epoch !== epoch || this.state.draft !== d) return;
            if (d.generation !== d.acknowledgedGeneration) {
              // Project deletion unlinks without a Notes revision increment.
              if (base.revision === d.base?.revision)
                this.draft({
                  base: { ...d.base, projectId: base.projectId },
                  projectId: base.projectId,
                });
            } else if (
              base.contentMarkdown !== d.contentMarkdown ||
              (base.title ?? "") !== d.title ||
              base.status !== d.base?.status
            ) {
              this.install(base);
            } else this.draft({ base, projectId: base.projectId });
          },
        )
        .catch(
          /** Preserve content when the record disappears. */ (error) => {
            if (this.state.draft === d)
              this.draft({ phase: "error", message: noteErrorCopy(error) });
          },
        );
    }
  };
  /** Install a fresh authoritative edit lifetime. */
  install(base: NoteDto | null, projectId: string | null = null) {
    clearTimeout(this.timer);
    this.editorState = undefined;
    this.editorScroll = 0;
    this.previewScroll = 0;
    this.publish({
      draft: {
        base,
        title: base?.title ?? "",
        contentMarkdown: base?.contentMarkdown ?? "",
        projectId: base ? base.projectId : projectId,
        generation: 0,
        acknowledgedGeneration: 0,
        mode: base && base.status !== "active" ? "preview" : "edit",
        phase: base ? "saved" : "draft",
        conflict: null,
        message: null,
        identity: ++this.serial,
      },
    });
  }
  /** Admit a note switch only after the current edit is settled. */
  async select(noteId: string | null, projectId: string | null = null) {
    if (this.state.blocked || this.state.actionBusy) throw new Error("Notes are busy");
    if (noteId && this.state.draft?.base?.id === noteId) return;
    const selection = ++this.selection;
    await this.flush(true);
    if (selection !== this.selection || this.state.blocked) return;
    const retained = this.state.draft;
    const base = noteId ? await ipc.getNote(noteId) : null;
    if (selection !== this.selection || this.state.blocked) return;
    if (
      this.state.draft?.identity !== retained?.identity ||
      this.state.draft?.generation !== retained?.generation
    ) {
      this.draft({ message: "The current note has new edits. Save it before switching notes." });
      throw new Error("New edits arrived during selection");
    }
    this.install(base, projectId);
  }
  /** Explicitly discard local text without replaying uncertain creation. */
  discard = () => {
    if (this.flight || this.state.blocked || this.state.actionBusy) return;
    ++this.selection;
    clearTimeout(this.timer);
    this.editorState = undefined;
    this.publish({ draft: null });
  };
  /** Validate title scalars and body bytes before entering the autosave queue. */
  edit(patch: Partial<Pick<NoteDraft, "title" | "contentMarkdown" | "projectId">>) {
    const d = this.state.draft;
    if (!d || this.state.blocked || this.state.actionBusy || (d.base && d.base.status !== "active"))
      return;
    const next = { ...d, ...patch };
    if (
      Array.from(next.title).length > 255 ||
      Array.from(next.title).some(
        /** Reject title controls by scalar value. */ (char) =>
          char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      new TextEncoder().encode(next.contentMarkdown).length > 1048576
    ) {
      this.draft({
        message:
          "Use a title of at most 255 characters without controls and Markdown within 1 MiB.",
      });
      return;
    }
    const stopped = ["conflict", "uncertain", "error"].includes(d.phase);
    this.draft({
      ...patch,
      generation: d.generation + 1,
      phase: stopped ? d.phase : "dirty",
      message: stopped ? d.message : null,
    });
    if (!stopped) this.schedule();
  }
  /** Debounce only admitted, non-composing edits. */
  schedule() {
    clearTimeout(this.timer);
    if (!this.composing && !this.state.blocked)
      this.timer = setTimeout(
        /** Observe autosave failure in the retained draft. */ () => {
          void this.flush().catch(/** Keep the explicit recovery state. */ () => {});
        },
        500,
      );
  }
  /** Suspend autosave until IME has committed its text. */
  composition(value: boolean) {
    this.composing = value;
    clearTimeout(this.timer);
    if (!value) this.schedule();
  }
  /** Drain generations serially, never replaying an unknown create automatically. */
  async flush(requireValid = false): Promise<void> {
    clearTimeout(this.timer);
    while (this.flight) await this.flight;
    const d = this.state.draft;
    if (!d) return;
    if (["error", "conflict", "uncertain"].includes(d.phase))
      throw new Error("Resolve the retained note first");
    if (this.composing) throw new Error("Finish composing before continuing");
    if (!d.base && !d.contentMarkdown.trim()) {
      if (requireValid) {
        this.draft({ message: "Discard this draft or add content before continuing." });
        throw new Error("Initial draft is empty");
      }
      return;
    }
    if (d.generation === d.acknowledgedGeneration) return;
    this.flight = this.save(d);
    try {
      await this.flight;
    } finally {
      this.flight = null;
    }
    if (this.state.draft && this.state.draft.generation !== this.state.draft.acknowledgedGeneration)
      await this.flush(requireValid);
  }
  /** Save one captured generation and preserve all input typed during the flight. */
  async save(d: NoteDraft) {
    this.draft({ phase: "saving", message: null });
    try {
      const base = d.base
        ? await ipc.autosaveNote({
            noteId: d.base.id,
            expectedRevision: d.base.revision,
            title: d.title || null,
            contentMarkdown: d.contentMarkdown,
          })
        : await ipc.createNote({
            title: d.title || null,
            contentMarkdown: d.contentMarkdown,
            projectId: d.projectId,
          });
      if (this.state.draft?.identity !== d.identity) return;
      this.draft({
        base,
        projectId: base.projectId,
        acknowledgedGeneration: d.generation,
        phase: this.state.draft.generation === d.generation ? "saved" : "dirty",
      });
      this.invalidate();
    } catch (error) {
      if (this.state.draft?.identity !== d.identity) throw error;
      const payload = error instanceof IpcCallError ? (error.payload as NotesError | null) : null;
      if (payload?.code === "revision_conflict")
        this.draft({ phase: "conflict", conflict: payload.current, message: noteErrorCopy(error) });
      else if (!payload && !d.base)
        this.draft({
          phase: "uncertain",
          message: "Could not confirm creation. Check Notes before creating another note.",
        });
      else if (!payload && d.base) {
        try {
          const current = await ipc.getNote(d.base.id);
          if (
            current.title === (d.title || null) &&
            current.contentMarkdown === d.contentMarkdown
          ) {
            this.draft({
              base: current,
              acknowledgedGeneration: d.generation,
              phase: this.state.draft.generation === d.generation ? "saved" : "dirty",
            });
            this.invalidate();
            return;
          }
          this.draft({
            phase: "conflict",
            conflict: current,
            message: "Could not confirm the save. Review the current version.",
          });
        } catch {
          this.draft({ phase: "uncertain", message: noteErrorCopy(error) });
        }
      } else this.draft({ phase: "error", message: noteErrorCopy(error) });
      throw error;
    }
  }
  /** Retry a known failure only after explicit intent. */
  retry = async () => {
    const d = this.state.draft;
    if (!d || this.state.blocked) return;
    if (d.phase === "uncertain") {
      if (!d.base) return;
      const current = await ipc.getNote(d.base.id);
      this.draft({
        phase: "conflict",
        conflict: current,
        message: "Review the current version before saving again.",
      });
      return;
    }
    this.draft({ phase: "dirty", message: null });
    await this.flush();
  };
  /** Resolve a conflict using explicit latest-version or overwrite intent. */
  resolve = async (keepLocal: boolean) => {
    const d = this.state.draft;
    if (!d?.conflict || this.state.blocked) return;
    if (!keepLocal) this.install(d.conflict);
    else if (d.conflict.status === "active") {
      this.draft({ base: d.conflict, conflict: null, phase: "dirty", message: null });
      await this.flush();
    }
  };
  /** Allow another create only after the user acknowledges possible duplication. */
  createAnother = async () => {
    const d = this.state.draft;
    if (!d || d.base || d.phase !== "uncertain" || this.state.blocked) return;
    this.draft({ phase: "dirty", message: null });
    await this.flush();
  };
  /** Serialize metadata/lifecycle actions after content acknowledgement. */
  mutate(operation: (base: NoteDto) => Promise<NoteDto | null>): Promise<void> {
    if (this.state.blocked || this.state.actionBusy) return Promise.resolve();
    this.actionFlight = this.performMutation(operation);
    return this.actionFlight;
  }
  /** Keep an admitted metadata operation observable to maintenance. */
  async performMutation(operation: (base: NoteDto) => Promise<NoteDto | null>) {
    if (this.state.blocked || this.state.actionBusy) return;
    this.publish({ actionBusy: true });
    try {
      await this.flush(true);
      const d = this.state.draft;
      if (!d?.base) return;
      const base = await operation(d.base);
      if (base) this.install(base);
      else {
        this.publish({ draft: null });
        this.editorState = undefined;
      }
      this.invalidate();
    } catch (error) {
      const payload = error instanceof IpcCallError ? (error.payload as NotesError | null) : null;
      if (payload?.code === "revision_conflict")
        this.draft({ phase: "conflict", conflict: payload.current, message: noteErrorCopy(error) });
      else {
        this.draft({ message: noteErrorCopy(error) });
        if (!payload && this.state.draft?.base) {
          try {
            const base = await ipc.getNote(this.state.draft.base.id);
            this.install(base);
            this.draft({
              message: "Action outcome refreshed. Review the note before acting again.",
            });
          } catch {
            this.draft({ phase: "uncertain", message: noteErrorCopy(error) });
          }
        }
      }
      this.invalidate();
    } finally {
      this.publish({ actionBusy: false });
      this.actionFlight = null;
    }
  }
  /** Retain manual input without scheduling an autosave. */
  editQuickNote(patch: Partial<Pick<QuickNoteState, "title" | "contentMarkdown" | "projectId">>) {
    if (this.state.blocked || this.quickFlight || this.state.quickNote.phase === "uncertain")
      return;
    this.publish({
      quickNote: {
        ...this.state.quickNote,
        ...patch,
        phase: "editing",
        message: null,
        savedNote: null,
      },
    });
  }
  /** Abandon only local manual intent, never a possibly persisted record. */
  cancelQuickNote = () => {
    if (this.state.blocked || this.quickFlight) return;
    this.publish({ quickNote: emptyQuickNote(++this.serial) });
  };
  /** Claim one explicit create synchronously before returning to the event loop. */
  saveQuickNote = (): Promise<void> => {
    if (this.state.blocked || this.quickFlight || this.state.quickNote.phase === "uncertain")
      return this.quickFlight ?? Promise.resolve();
    const draft = this.state.quickNote;
    if (!draft.contentMarkdown.trim()) return Promise.resolve();
    this.publish({ quickNote: { ...draft, phase: "saving", message: null, savedNote: null } });
    const flight = this.createQuickNote(draft);
    this.quickFlight = flight;
    return flight;
  };
  /** Publish only acknowledged creation and never replay an unknown transport outcome. */
  async createQuickNote(draft: QuickNoteState) {
    try {
      const savedNote = await ipc.createNote({
        title: draft.title || null,
        contentMarkdown: draft.contentMarkdown,
        projectId: draft.projectId,
      });
      if (this.state.quickNote.identity !== draft.identity) return;
      this.publish({ quickNote: { ...emptyQuickNote(++this.serial), phase: "saved", savedNote } });
      this.invalidate();
    } catch (error) {
      if (this.state.quickNote.identity !== draft.identity) return;
      const known = error instanceof IpcCallError && error.payload;
      this.publish({
        quickNote: {
          ...draft,
          phase: known ? "error" : "uncertain",
          message: known
            ? noteErrorCopy(error)
            : "Could not confirm creation. Check Notes before creating another note.",
        },
      });
      if (!known) this.invalidate();
    } finally {
      this.quickFlight = null;
    }
  }
  /** Claim admission synchronously before waiting for existing writes. */
  settleBeforeDataChange = async () => {
    this.publish({ blocked: true });
    ++this.selection;
    clearTimeout(this.timer);
    if (this.quickFlight) await this.quickFlight;
    const quick = this.state.quickNote;
    if (
      quick.title ||
      quick.contentMarkdown ||
      quick.projectId ||
      quick.phase === "uncertain" ||
      quick.phase === "error"
    ) {
      const message = "Save or cancel the Quick Note on Home before changing app data.";
      this.publish({ quickNote: { ...quick, message } });
      throw new Error(message);
    }
    if (this.actionFlight) await this.actionFlight;
    if (this.state.actionBusy) throw new Error("A Trash confirmation is pending");
    await this.flush(true);
  };
  /** Release admission only after app-level reconciliation completes. */
  releaseDataChangeBarrier = () => {
    this.publish({ blocked: false });
  };
  /** Retire drafts before reset navigation can mount another consumer. */
  clearAfterReset = () => {
    ++this.selection;
    clearTimeout(this.timer);
    this.editorState = undefined;
    this.maintenanceNoteId = null;
    this.publish({
      draft: null,
      quickNote: emptyQuickNote(++this.serial),
      epoch: this.state.epoch + 1,
    });
  };
  /** Re-read imported or uncertain data without replaying the old draft. */
  refreshAfterDataChange = async () => {
    clearTimeout(this.timer);
    const id = this.state.draft?.base?.id ?? this.maintenanceNoteId;
    this.clearAfterReset();
    this.maintenanceNoteId = id;
    const selection = this.selection;
    if (id) {
      try {
        const base = await ipc.getNote(id);
        if (selection === this.selection) {
          this.install(base);
          this.maintenanceNoteId = null;
        }
      } catch (error) {
        if (!(error instanceof IpcCallError && error.payload?.code === "note_not_found"))
          throw error;
        if (selection === this.selection) this.maintenanceNoteId = null;
      }
    }
    // The detail was already reconciled; only aggregate readers need another query.
    this.publish({ epoch: this.state.epoch + 1 });
  };
  /** Reconcile an uncertain maintenance outcome by reading, never replaying writes. */
  reconcileAfterResetFailure = () => this.refreshAfterDataChange();
}
const Context = createContext<NotesOwner | null>(null);
/** Retain the owner across every ordinary route and clean late native registrations. */
export function NotesProvider({ children }: { children: ReactNode }) {
  const [owner] = useState(/** Create one isolated owner per provider. */ () => new NotesOwner());
  useEffect(
    /** Register invalidation before consumers issue their refreshed reads. */ () => {
      let live = true;
      const removers: Array<() => void> = [];
      let sequence = -1n;
      const registrations = [
        ipc.onNotesChanged(
          /** Ignore duplicate or out-of-order process events. */ (event) => {
            if (live && BigInt(event.sequence) > sequence) {
              sequence = BigInt(event.sequence);
              owner.invalidate();
            }
          },
        ),
        onProjectsChanged(
          /** Refresh FK-unlinked snapshots too. */ () => {
            if (live) owner.invalidate();
          },
        ),
      ];
      for (const registration of registrations)
        void registration
          .then(
            /** Dispose registrations that resolve after unmount. */ (remove) => {
              if (live) {
                removers.push(remove);
                owner.invalidate();
              } else remove();
            },
          )
          .catch(
            /** Expose command-result fallback. */ () => {
              if (live) owner.publish({ listenerFailed: true });
            },
          );
      const visibility =
        /** Flush hidden drafts best-effort and revalidate foreground snapshots. */ () => {
          if (document.hidden)
            void owner.flush().catch(/** Retain any failed draft for recovery. */ () => {});
          else owner.invalidate();
        };
      window.addEventListener("focus", owner.invalidate);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        live = false;
        for (const remove of removers) remove();
        clearTimeout(owner.timer);
        window.removeEventListener("focus", owner.invalidate);
        document.removeEventListener("visibilitychange", visibility);
      };
    },
    [owner],
  );
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
/** Read internal draft state and its stable owner. */
export function useNotes() {
  const owner = useContext(Context);
  if (!owner) throw new Error("NotesProvider is required");
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot);
  return { owner, ...state };
}
const emptyBoundary = {
  /** Provide inert composition outside the app host. */ settleBeforeDataChange: async () => {},
  /** Release the inert boundary. */ releaseDataChangeBarrier: () => {},
  /** Clear the inert boundary. */ clearAfterReset: () => {},
  /** Refresh the inert boundary. */ refreshAfterDataChange: async () => {},
  /** Reconcile the inert boundary. */ reconcileAfterResetFailure: async () => {},
};
/** Expose only maintenance methods to app composition. */
export function useNotesDataBoundary(): {
  settleBeforeDataChange(): Promise<void>;
  releaseDataChangeBarrier(): void;
  clearAfterReset(): void;
  refreshAfterDataChange(): Promise<void>;
  reconcileAfterResetFailure(): Promise<void>;
} {
  return useContext(Context) ?? emptyBoundary;
}
/** Query one server projection with immediate stale-response invalidation. */
export function useNotesQuery(input: ListNotesInputDto, delay = 0) {
  const context = useContext(Context);
  const [epoch, setEpoch] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<NoteListPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(input);
  const current = useRef(key);
  current.current = key;
  useEffect(
    /** Observe provider invalidations without another native listener. */ () =>
      context?.subscribe(/** Advance query lifetime. */ () => setEpoch(context.state.epoch)),
    [context],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch and explicit retry invalidate this query lifetime.
  useEffect(
    /** Debounce requests and retire all older responses immediately. */ () => {
      let live = true;
      const ownerEpoch = context?.state.epoch;
      setLoading(true);
      const timer = setTimeout(
        /** Issue only the latest query. */ () => {
          void ipc
            .listNotes(JSON.parse(key) as ListNotesInputDto)
            .then(
              /** Publish only the matching lifetime. */ (result) => {
                if (live && current.current === key && context?.state.epoch === ownerEpoch) {
                  setPage(result);
                  setError(null);
                  setLoading(false);
                }
              },
            )
            .catch(
              /** Keep a failed read distinct from empty data. */ (failure) => {
                if (live && current.current === key && context?.state.epoch === ownerEpoch) {
                  setError(noteErrorCopy(failure));
                  setLoading(false);
                }
              },
            );
        },
        delay,
      );
      return () => {
        live = false;
        clearTimeout(timer);
      };
    },
    [key, epoch, retry, delay, context],
  );
  return {
    page,
    error,
    loading,
    epoch,
    refresh: /** Retry a read without replaying a write. */ () => setRetry((value) => value + 1),
  };
}
/** Determine presence from all lifecycle counts, including Archive and Trash. */
export function useNotesPresence(): {
  status: "loading" | "present" | "empty" | "error";
  retry(): void;
} {
  const query = useNotesQuery({
    status: "active",
    query: null,
    projectFilter: { kind: "all" },
    pinnedFilter: "any",
    offset: 0,
    limit: 1,
  });
  return {
    status: query.error
      ? "error"
      : !query.page
        ? "loading"
        : Object.values(query.page.counts).some(
              /** Count every persisted lifecycle. */ (count) => count > 0,
            )
          ? "present"
          : "empty",
    retry: query.refresh,
  };
}
