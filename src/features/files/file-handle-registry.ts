import type { EditorState } from "@codemirror/state";
import type {
  ExternalFileResolutionDto,
  FileEntryPathsDto,
  FileEntryRequestDto,
  FileHandleChangedEventDto,
  FileHandleDto,
  FileHandleRequestDto,
  TextFileDto,
} from "@/bindings/files/files";
import type { PaneLayoutNodeDto } from "@/bindings/sessions/sessions";
import type { FileEditCallbacks, FileEditScope } from "@/lib/ipc/file-edit-boundary";
import {
  getFileEntryPaths,
  getOpenFile,
  onFileHandleChanged,
  openFileWithDefaultApp,
  reloadOpenFile,
  resolveExternalFileChange,
  saveMarkdownFile,
  updateMarkdownBuffer,
} from "@/lib/ipc/files";
import { getSession } from "@/lib/ipc/sessions";
import { fileErrorCode, fileErrorCopy } from "./file-error-copy";

/** Snapshot every pane of the same handle reads. */
export interface FileHandleEntryState {
  handle: FileHandleDto | null;
  phase: "loading" | "ready" | "failed";
  failure: string | null;
  failureCode: string | undefined;
  isReloading: boolean;
  externalPending: boolean;
  externalFailure: string | null;
  copyFeedback: string;
  announcement: string;
  draft: string | null;
  markdownFile: TextFileDto | null;
  markdownMode: "edit" | "preview";
  isDirty: boolean;
  isSaving: boolean;
  isResolving: boolean;
  admissionBlocked: boolean;
}

/** One handle retained outside the component lifetime of its panes. */
export interface FileHandleEntry {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileHandleEntryState;
  retain(): () => void;
  reload(): Promise<void>;
  setMarkdownText(text: string): void;
  setMarkdownMode(mode: "edit" | "preview"): void;
  flushMarkdown(): Promise<void>;
  saveMarkdown(): Promise<void>;
  resolveMarkdown(resolution: ExternalFileResolutionDto): Promise<void>;
  readEditorState(): EditorState | null;
  writeEditorState(state: EditorState): void;
  claimAdmission(): () => void;
  setComposition(active: boolean, finish?: () => void): void;
  settleMarkdown(): Promise<void>;
  openWithDefaultApp(): Promise<void>;
  copyPath(): Promise<void>;
  readScrollTop(): number;
  writeScrollTop(value: number): void;
  readPreviewScrollTop(): number;
  writePreviewScrollTop(value: number): void;
}

/** Files-local transport seam; tests substitute fresh fakes per case. */
export interface FileHandleRegistryDependencies {
  getOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>;
  reloadOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>;
  openFileWithDefaultApp(request: FileHandleRequestDto): Promise<void>;
  onFileHandleChanged(listener: (event: FileHandleChangedEventDto) => void): Promise<() => void>;
  getFileEntryPaths(request: FileEntryRequestDto): Promise<FileEntryPathsDto>;
  writeText(text: string): Promise<void>;
  updateMarkdownBuffer?: typeof updateMarkdownBuffer;
  saveMarkdownFile?: typeof saveMarkdownFile;
  resolveExternalFileChange?: typeof resolveExternalFileChange;
  getSession?: typeof getSession;
}

/** Production transport: real BE-014 wrappers and the clipboard mechanism used elsewhere. */
const productionDependencies: FileHandleRegistryDependencies = {
  getOpenFile,
  /** Invoke this capability only when its explicit intent is requested. */
  getSession: (request) => getSession(request),
  /** Invoke this capability only when its explicit intent is requested. */
  updateMarkdownBuffer: (request) => updateMarkdownBuffer(request),
  /** Invoke this capability only when its explicit intent is requested. */
  saveMarkdownFile: (request) => saveMarkdownFile(request),
  /** Invoke this capability only when its explicit intent is requested. */
  resolveExternalFileChange: (request) => resolveExternalFileChange(request),
  reloadOpenFile,
  openFileWithDefaultApp,
  onFileHandleChanged,
  getFileEntryPaths,
  /** Write one resolved path with the same browser clipboard API File Explorer uses. */
  writeText: (text: string) => navigator.clipboard.writeText(text),
};

/** Largest number of handles kept in memory; only unused entries are ever dropped. */
const ENTRY_LIMIT = 64;

/** Live-region text published after content was actually replaced. */
const RELOAD_ANNOUNCEMENT = "File reloaded from disk.";

/** Live-region text published only after the clipboard write resolved. */
const COPY_SUCCESS = "Path copied.";

/**
 * Copy-path failure text from FE-017. It lives here as registry state because Task 5 owns
 * the shared viewer copy table; move it there rather than duplicating it a third time.
 */
const COPY_FAILURE = "Could not copy path. Try again.";

/** Backend codes that permanently invalidate a handle instead of inviting a retry. */
const RETIRING_CODES = ["invalidFileHandleId", "fileHandleNotFound"];

/** Opener failures meaning the retained snapshot no longer describes the file on disk. */
const OPENER_RESTALE_CODES = ["entryNotFound", "linkTraversalDenied", "projectRootChanged"];

/** Path-lookup failures that explain the entry rather than the clipboard. */
const UNAVAILABLE_ENTRY_CODES = ["entryNotFound", "entryNotVisible", "linkTraversalDenied"];

/** Initial state published before any authoritative snapshot exists. */
const INITIAL_STATE: FileHandleEntryState = {
  handle: null,
  phase: "loading",
  failure: null,
  failureCode: undefined,
  isReloading: false,
  externalPending: false,
  externalFailure: null,
  copyFeedback: "",
  announcement: "",
  draft: null,
  markdownFile: null,
  markdownMode: "edit",
  isDirty: false,
  isSaving: false,
  isResolving: false,
  admissionBlocked: false,
};

/**
 * Read one decimal backend revision. `BigInt` is required because revisions may pass the
 * safe integer range and because string ordering would rank `10` below `9`.
 */
function parseRevision(revision: string): bigint | null {
  try {
    return BigInt(revision);
  } catch {
    return null;
  }
}

/** Choose the copy that matches a failed path lookup or a rejected clipboard write. */
function copyFailureCopy(error: unknown): string {
  const code = fileErrorCode(error);
  return code !== undefined && UNAVAILABLE_ENTRY_CODES.includes(code)
    ? fileErrorCopy(error)
    : COPY_FAILURE;
}

/** One retained handle with its shared snapshot, actions and scroll position. */
export class FileHandleRegistryEntry implements FileHandleEntry {
  private state: FileHandleEntryState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private references = 0;
  private localGeneration = 0;
  private acknowledgedGeneration = 0;
  private baseDiskRevision: string | null = null;
  private updatePromise: Promise<void> | null = null;
  private savePromise: Promise<void> | null = null;
  private editorState: EditorState | null = null;
  private admissionCount = 0;
  private previewScrollTop = 0;
  private composition: Promise<void> | null = null;
  private finishComposition: (() => void) | null = null;
  private resolveComposition: (() => void) | null = null;
  private pendingRead: Promise<void> | null = null;
  /** Greatest revision an invalidation asked for; the high-water mark of pending intent. */
  private requestedRevision: bigint | null = null;
  private announceOnPublish = false;
  private reloadPending = false;
  private openerPending = false;
  private copyPending = false;
  private retired = false;
  private disposed = false;

  /** Creates one entry owned by its registry. */
  constructor(
    readonly id: string,
    private readonly registry: FileHandleRegistry,
  ) {}

  /** Returns one immutable state snapshot for React external-store subscriptions. */
  getSnapshot = (): FileHandleEntryState => this.state;

  /** Subscribes one view to entry changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Registers one viewer, starts the single first read, and returns a balanced release. */
  retain(): () => void {
    this.references += 1;
    // Only a handle that never produced a snapshot needs its first read; a cached ready
    // entry, a failed entry awaiting an explicit retry, and an in-flight read all skip it.
    if (
      !this.retired &&
      !this.disposed &&
      this.state.handle === null &&
      this.state.phase === "loading" &&
      this.pendingRead === null
    ) {
      this.startRead(false);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.references = Math.max(0, this.references - 1);
    };
  }

  /** Reports whether any mounted view still displays this handle. */
  isRetained(): boolean {
    return this.references > 0;
  }

  /** Re-reads the handle from disk; one click may only send one command. */
  async reload(): Promise<void> {
    if (this.reloadPending || this.retired || this.disposed) return;
    const lifetime = this.registry.lifetime;
    this.reloadPending = true;
    this.patch({ isReloading: true, failure: null, failureCode: undefined });
    try {
      const snapshot = await this.registry.dependencies.reloadOpenFile({ fileHandleId: this.id });
      if (!this.isCurrent(lifetime)) return;
      this.announceOnPublish = true;
      this.publish(snapshot);
    } catch (error) {
      // A recoverable reload failure keeps the previously read content on screen.
      if (this.isCurrent(lifetime)) this.failRead(error);
    } finally {
      this.reloadPending = false;
      if (this.isLive(lifetime)) this.patch({ isReloading: false });
    }
  }

  /** Retain mode independently of the mounted view. */
  setMarkdownMode(mode: "edit" | "preview"): void {
    this.patch({ markdownMode: mode });
  }
  /** Read the immutable CodeMirror state retained on unmount. */
  readEditorState(): EditorState | null {
    return this.editorState;
  }
  /** Retain selection and history without retaining a DOM view. */
  writeEditorState(state: EditorState): void {
    this.editorState = state;
  }
  /** Claim a refcounted admission lease synchronously before any asynchronous flush. */
  claimAdmission(): () => void {
    this.finishComposition?.();
    this.admissionCount += 1;
    this.patch({ admissionBlocked: true });
    let released = false;
    /** Release this lease at most once, preserving nested claims. */
    return () => {
      if (released) return;
      released = true;
      this.admissionCount -= 1;
      this.patch({ admissionBlocked: this.admissionCount > 0 });
    };
  }
  /** Accept one lossless transaction and dispatch the first update immediately. */
  setMarkdownText(text: string): void {
    if (
      (this.state.admissionBlocked && this.composition === null) ||
      this.retired ||
      this.disposed ||
      this.state.draft === null ||
      text === this.state.draft
    )
      return;
    if (
      new TextEncoder().encode(text).length + (this.state.markdownFile?.hasUtf8Bom ? 3 : 0) >
      5_242_880
    ) {
      this.patch({ failure: "Markdown files cannot exceed 5 MiB. This edit was not applied." });
      return;
    }
    this.localGeneration += 1;
    this.patch({ draft: text, isDirty: true, failure: null });
    if (this.updatePromise === null && this.composition === null)
      void this.flushMarkdown().catch(() => undefined);
  }
  /** Track IME completion at the shared entry, including Save from the separate header. */
  setComposition(active: boolean, finish?: () => void): void {
    if (active && this.composition === null) {
      this.composition = new Promise<void>((resolve) => {
        this.resolveComposition = resolve;
      });
      this.finishComposition = finish ?? null;
    } else if (!active && this.composition !== null) {
      this.resolveComposition?.();
      this.composition = null;
      this.resolveComposition = null;
      this.finishComposition = null;
      void this.flushMarkdown().catch(() => undefined);
    }
  }
  /** Wait for a complete composition; refusal keeps every destructive target open. */
  private async settleComposition(): Promise<void> {
    if (!this.composition) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.composition,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Finish composing text before continuing.")),
            1_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Drain one in-flight update and one coalesced latest snapshot without replaying writes. */
  async flushMarkdown(): Promise<void> {
    if (this.composition !== null) await this.settleComposition();
    if (this.updatePromise !== null) return this.updatePromise;
    if (this.localGeneration === this.acknowledgedGeneration) return;
    const lifetime = this.registry.lifetime;
    this.updatePromise = this.drainUpdates(lifetime);
    try {
      await this.updatePromise;
    } finally {
      this.updatePromise = null;
    }
  }
  /** Await pending Save as well as updates before any destructive command inspects state. */
  async settleMarkdown(): Promise<void> {
    await this.flushMarkdown();
    if (this.savePromise) await this.savePromise;
    await this.flushMarkdown();
  }
  /** Reconcile a rejected revision once while retaining the original rendered disk token. */
  private async drainUpdates(lifetime: number): Promise<void> {
    try {
      while (this.localGeneration !== this.acknowledgedGeneration && this.isCurrent(lifetime)) {
        const generation = this.localGeneration;
        const text = this.state.draft;
        const handle = this.state.handle;
        if (text === null || handle === null || this.baseDiskRevision === null)
          throw new Error("Markdown is unavailable.");
        const update = this.registry.dependencies.updateMarkdownBuffer;
        if (!update) throw new Error("Markdown transport is unavailable.");
        let snapshot: FileHandleDto;
        try {
          snapshot = await update({
            fileHandleId: this.id,
            expectedRevision: handle.revision,
            baseDiskRevision: this.baseDiskRevision,
            text,
          });
        } catch (error) {
          const latest = await this.registry.dependencies.getOpenFile({ fileHandleId: this.id });
          if (!this.isCurrent(lifetime)) return;
          this.publish(latest);
          const local = markdownText(latest);
          if (local?.text === text) snapshot = latest;
          else if (fileErrorCode(error) === "revisionConflict")
            snapshot = await update({
              fileHandleId: this.id,
              expectedRevision: latest.revision,
              baseDiskRevision: this.baseDiskRevision,
              text,
            });
          else throw error;
        }
        if (!this.isCurrent(lifetime)) return;
        this.acknowledgedGeneration = generation;
        this.publish(snapshot);
        this.patch({ isDirty: this.localGeneration !== generation || snapshot.isDirty });
      }
    } catch (error) {
      if (this.isCurrent(lifetime))
        this.patch({ failure: fileErrorCopy(error), failureCode: fileErrorCode(error) });
      throw error;
    }
  }
  /** Save one acknowledged revision; new edits remain dirty and are never implicitly saved. */
  async saveMarkdown(): Promise<void> {
    if (this.savePromise) return this.savePromise;
    this.savePromise = this.performSave();
    try {
      await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }
  /** Perform a single disk write and reconcile failures before a later explicit retry. */
  private async performSave(): Promise<void> {
    const lifetime = this.registry.lifetime;
    this.patch({ isSaving: true, failure: null });
    try {
      await this.flushMarkdown();
      const handle = this.state.handle;
      if (!handle || !this.state.isDirty) return;
      if (handle.state.kind !== "ready") throw new Error("Resolve the file state before saving.");
      const save = this.registry.dependencies.saveMarkdownFile;
      if (!save) throw new Error("Markdown transport is unavailable.");
      const result = await save({ fileHandleId: this.id, expectedRevision: handle.revision });
      if (!this.isCurrent(lifetime)) return;
      if (result.savedDisk) this.baseDiskRevision = result.savedDisk.diskRevision;
      this.publish(result.file);
      this.patch({
        announcement: this.state.isDirty ? "Saved. Newer changes are not saved yet." : "Saved.",
      });
    } catch (error) {
      if (this.isCurrent(lifetime)) {
        try {
          this.publish(await this.registry.dependencies.getOpenFile({ fileHandleId: this.id }));
        } catch {
          /* Retain draft when reconciliation is unavailable. */
        }
        if (this.isCurrent(lifetime))
          this.patch({ failure: fileErrorCopy(error), failureCode: fileErrorCode(error) });
      }
      throw error;
    } finally {
      if (this.isCurrent(lifetime)) this.patch({ isSaving: false });
    }
  }
  /** Resolve exactly one explicit choice; stale conflicts require another user choice. */
  async resolveMarkdown(resolution: ExternalFileResolutionDto): Promise<void> {
    if (this.state.isResolving || this.state.admissionBlocked) return;
    const release = this.claimAdmission();
    const lifetime = this.registry.lifetime;
    this.patch({ isResolving: true, failure: null });
    try {
      await this.flushMarkdown();
      const handle = this.state.handle;
      const resolve = this.registry.dependencies.resolveExternalFileChange;
      if (!handle || !resolve) throw new Error("Markdown is unavailable.");
      const result = await resolve({
        fileHandleId: this.id,
        expectedRevision: handle.revision,
        resolution,
      });
      if (!this.isCurrent(lifetime)) return;
      if (resolution === "reloadFromDisk") {
        this.editorState = null;
        this.patch({ draft: null });
      }
      if (result.state.kind === "ready") this.baseDiskRevision = result.state.disk.diskRevision;
      this.publish(result);
    } catch (error) {
      if (this.isCurrent(lifetime)) {
        try {
          this.publish(await this.registry.dependencies.getOpenFile({ fileHandleId: this.id }));
        } catch {
          /* Retain recovery text. */
        }
        if (this.isCurrent(lifetime))
          this.patch({ failure: fileErrorCopy(error), failureCode: fileErrorCode(error) });
      }
      throw error;
    } finally {
      release();
      if (this.isCurrent(lifetime)) this.patch({ isResolving: false });
    }
  }

  /** Asks the operating system to open the handle; one click may only send one command. */
  async openWithDefaultApp(): Promise<void> {
    if (this.openerPending || this.retired || this.disposed) return;
    const lifetime = this.registry.lifetime;
    this.openerPending = true;
    this.patch({ externalPending: true, externalFailure: null });
    try {
      await this.registry.dependencies.openFileWithDefaultApp({ fileHandleId: this.id });
    } catch (error) {
      if (!this.isCurrent(lifetime)) return;
      const code = fileErrorCode(error);
      this.patch({ externalFailure: fileErrorCopy(error) });
      // Path and root rejections prove the retained snapshot is stale, so re-read it.
      if (code !== undefined && OPENER_RESTALE_CODES.includes(code)) this.startRead(false);
      else if (code !== undefined && RETIRING_CODES.includes(code)) this.failRead(error);
    } finally {
      this.openerPending = false;
      if (this.isLive(lifetime)) this.patch({ externalPending: false });
    }
  }

  /** Resolves a fresh absolute path, writes it, and only then announces the result. */
  async copyPath(): Promise<void> {
    const snapshot = this.state.handle;
    if (this.copyPending || snapshot === null || this.retired || this.disposed) return;
    const lifetime = this.registry.lifetime;
    this.copyPending = true;
    this.patch({ copyFeedback: "" });
    try {
      const paths = await this.registry.dependencies.getFileEntryPaths({
        projectId: snapshot.projectId,
        relativePath: snapshot.relativePath,
      });
      // The entry can lose its lifetime between the lookup and the clipboard write.
      if (!this.isCurrent(lifetime)) return;
      await this.registry.dependencies.writeText(paths.absolutePath);
      if (!this.isCurrent(lifetime)) return;
      this.patch({ copyFeedback: COPY_SUCCESS, announcement: COPY_SUCCESS });
    } catch (error) {
      if (this.isCurrent(lifetime)) this.patch({ copyFeedback: copyFailureCopy(error) });
    } finally {
      this.copyPending = false;
    }
  }

  /** Read Preview scroll separately from the editor scroll. */
  readPreviewScrollTop(): number {
    return this.previewScrollTop;
  }
  /** Retain Preview scroll across mode and route changes. */
  writePreviewScrollTop(value: number): void {
    this.previewScrollTop = value;
  }
  /** Reads the retained scroll offset of this handle. */
  readScrollTop(): number {
    return this.registry.scrollTop(this.id);
  }

  /** Retains the scroll offset of this handle for a later remount. */
  writeScrollTop(value: number): void {
    this.registry.writeScrollTop(this.id, value);
  }

  /** Await the existing initial read when a close target discovers an unmounted handle. */
  async ensureLoaded(): Promise<void> {
    if (this.state.handle === null) {
      this.startRead(false);
      await this.pendingRead;
    }
    if (this.state.handle === null) throw new Error(this.state.failure ?? "File unavailable.");
  }

  /** Re-reads the snapshot when a view still displays this handle. */
  refreshWhenRetained(): void {
    if (this.isRetained()) this.startRead(false);
  }

  /** Applies one invalidation by requesting a snapshot, never by patching from the event. */
  applyInvalidation(event: FileHandleChangedEventDto): void {
    if (this.retired || this.disposed) return;
    const incoming = parseRevision(event.revision);
    if (incoming === null) return;
    const current = this.currentRevision();
    // A revision that is not newer would only make the viewer flicker.
    if (current !== null && incoming <= current) return;
    if (this.requestedRevision === null || incoming > this.requestedRevision) {
      this.requestedRevision = incoming;
    }
    this.startRead(event.change === "reloaded");
  }

  /** Retires a permanently invalid handle while its subscribers keep rendering the failure. */
  private retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.pendingRead = null;
    this.requestedRevision = null;
    this.registry.remove(this);
  }

  /** Drops every resource of one entry that a reset or the entry bound removed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingRead = null;
    this.requestedRevision = null;
    this.listeners.clear();
  }

  /** Starts one read, coalescing every concurrent request into the in-flight one. */
  private startRead(announce: boolean): void {
    if (this.retired || this.disposed) return;
    if (announce) this.announceOnPublish = true;
    if (this.pendingRead !== null) return;
    const lifetime = this.registry.lifetime;
    if (this.state.failure !== null) this.patch({ failure: null, failureCode: undefined });
    const promise = this.runRead(lifetime).finally(() => {
      if (this.pendingRead !== promise) return;
      this.pendingRead = null;
      if (this.isCurrent(lifetime)) this.followUpWhenBehind();
    });
    this.pendingRead = promise;
  }

  /** Reads one authoritative snapshot and never publishes into a retired lifetime. */
  private async runRead(lifetime: number): Promise<void> {
    try {
      const snapshot = await this.registry.dependencies.getOpenFile({ fileHandleId: this.id });
      if (this.isCurrent(lifetime)) this.publish(snapshot);
    } catch (error) {
      if (this.isCurrent(lifetime)) this.failRead(error);
    }
  }

  /**
   * Issues at most one further read when the completed snapshot is still behind the greatest
   * requested revision. Clearing the mark first keeps a stubborn backend from looping.
   */
  private followUpWhenBehind(): void {
    const requested = this.requestedRevision;
    this.requestedRevision = null;
    if (requested === null) return;
    const current = this.currentRevision();
    if (current !== null && current >= requested) return;
    this.startRead(false);
  }

  /** Publishes one snapshot unless it is older than the one already displayed. */
  private publish(snapshot: FileHandleDto): void {
    const incoming = parseRevision(snapshot.revision);
    const current = this.currentRevision();
    if (incoming !== null && current !== null && incoming < current) return;
    const file = markdownText(snapshot);
    const pending = this.localGeneration !== this.acknowledgedGeneration;
    if (file && (!pending || this.state.draft === null)) {
      if (this.state.draft !== file.text) this.editorState = null;
      this.state = { ...this.state, draft: file.text, markdownFile: file };
      if (snapshot.state.kind === "ready") this.baseDiskRevision = snapshot.state.disk.diskRevision;
    }
    const announce = this.announceOnPublish;
    this.announceOnPublish = false;
    this.patch({
      handle: snapshot,
      isDirty: pending || snapshot.isDirty,
      phase: "ready",
      failure: null,
      failureCode: undefined,
      announcement: announce ? RELOAD_ANNOUNCEMENT : this.state.announcement,
    });
  }

  /** Records one rejected read and retires the entry for permanently invalid handles. */
  private failRead(error: unknown): void {
    const code = fileErrorCode(error);
    this.patch({ phase: "failed", failure: fileErrorCopy(error), failureCode: code });
    if (code !== undefined && RETIRING_CODES.includes(code)) this.retire();
  }

  /** Reads the revision of the displayed snapshot. */
  private currentRevision(): bigint | null {
    const snapshot = this.state.handle;
    return snapshot === null ? null : parseRevision(snapshot.revision);
  }

  /** Reports whether asynchronous work may still publish into this entry. */
  private isCurrent(lifetime: number): boolean {
    return this.isLive(lifetime) && !this.retired;
  }

  /** Reports whether the entry still belongs to the lifetime that started the work. */
  private isLive(lifetime: number): boolean {
    return !this.disposed && this.registry.lifetime === lifetime;
  }

  /** Replaces selected fields and notifies mounted views. */
  private patch(patch: Partial<FileHandleEntryState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    this.registry.syncAdmission(this);
    this.registry.notify();
  }
}

/** Root registry owning every open handle independently of route and pane lifetime. */
export class FileHandleRegistry {
  readonly dependencies: FileHandleRegistryDependencies;
  private readonly listeners = new Set<() => void>();
  private readonly scopeLeases = new Map<
    symbol,
    { scope: FileEditScope; releases: Map<FileHandleEntry, () => void> }
  >();
  /** Observe optimistic dirty projections without importing Files into consumers. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Publish one projection invalidation. */
  notify(): void {
    for (const listener of this.listeners) listener();
  }
  /** List retained entries for lifecycle projection and settlement. */
  allEntries(): FileHandleRegistryEntry[] {
    return [...this.entries.values()];
  }
  private readonly entries = new Map<string, FileHandleRegistryEntry>();
  private readonly scrollTops = new Map<string, number>();
  private unlisten: (() => void) | null = null;
  private monitoring = false;
  private monitorGeneration = 0;
  /** Reset epoch; work started in an older lifetime may never publish. */
  private epoch = 0;

  /** Creates a registry with an explicit transport seam. */
  constructor(dependencies: FileHandleRegistryDependencies = productionDependencies) {
    this.dependencies = dependencies;
  }

  /** Match backend identity against a frontend lifecycle scope. */
  matches(entry: FileHandleEntry, scope: FileEditScope): boolean {
    const handle = entry.getSnapshot().handle;
    if (scope.kind === "all") return true;
    if (!handle) return false;
    if (scope.kind === "project") return handle.projectId === scope.projectId;
    return (
      handle.sessionId === scope.sessionId &&
      (scope.kind === "session" ||
        (handle.tabId === scope.tabId && (scope.kind === "tab" || handle.paneId === scope.paneId)))
    );
  }
  /** Produce synchronous admission claims and a flush promise with balanced cleanup. */
  settle = async (scope: FileEditScope): Promise<() => void> => {
    const entries = this.allEntries().filter((entry) => this.matches(entry, scope));
    const releases = new Map<FileHandleEntry, () => void>();
    const leaseId = Symbol();
    this.scopeLeases.set(leaseId, { scope, releases });
    for (const entry of entries) {
      releases.set(entry, () => undefined);
      releases.set(entry, entry.claimAdmission());
    }
    let released = false;
    /** Release every target exactly once even when nested operations claim them again. */
    const release = () => {
      if (released) return;
      released = true;
      this.scopeLeases.delete(leaseId);
      for (const unlock of releases.values()) unlock();
    };
    try {
      // Resolve unknown identities before impact; active leases attach as snapshots publish.
      await Promise.allSettled(
        this.allEntries()
          .filter((entry) => entry.getSnapshot().handle === null)
          .map((entry) => entry.ensureLoaded()),
      );
      await Promise.all(
        this.allEntries()
          .filter((entry) => this.matches(entry, scope))
          .map((entry) => entry.settleMarkdown()),
      );
      return release;
    } catch (error) {
      release();
      throw error;
    }
  };
  /** Extend active leases to newly discovered handles before they can accept input. */
  syncAdmission(entry: FileHandleEntry): void {
    for (const { scope, releases } of this.scopeLeases.values()) {
      if (!releases.has(entry) && this.matches(entry, scope)) {
        releases.set(entry, () => undefined);
        releases.set(entry, entry.claimAdmission());
      }
    }
  }
  /** Read optimistic dirty state for every pane in a tab, not just its active pane. */
  hasPendingEdits = (scope: FileEditScope): boolean =>
    this.allEntries().some((entry) => this.matches(entry, scope) && entry.getSnapshot().isDirty);
  /** Save complete target contents, discovering unmounted file handles from real session IDs. */
  save = async (scope: FileEditScope): Promise<void> => {
    if (scope.kind === "all" || scope.kind === "project")
      throw new Error("Bulk saving is unavailable.");
    const readSession = this.dependencies.getSession;
    if (!readSession) throw new Error("Session transport is unavailable.");
    const session = await readSession(scope.sessionId);
    const handles: string[] = [];
    /** Collect only file identities from target leaves, never from impact labels. */
    const collect = (node: PaneLayoutNodeDto) => {
      if (node.kind === "split") {
        collect(node.first);
        collect(node.second);
      } else if (
        (scope.kind !== "pane" || node.pane.id === scope.paneId) &&
        node.pane.content.kind === "file"
      )
        handles.push(node.pane.content.fileHandleId);
    };
    for (const tab of session.tabs)
      if (scope.kind === "session" || tab.id === scope.tabId) collect(tab.layout);
    for (const id of handles) {
      const entry = this.entry(id);
      const release = entry.retain();
      try {
        await (entry as FileHandleRegistryEntry).ensureLoaded();
        if (entry.getSnapshot().draft === null) continue;
        await entry.saveMarkdown();
        if (entry.getSnapshot().isDirty || entry.getSnapshot().handle?.state.kind !== "ready")
          throw new Error("A file still has unsaved changes. Cancel to resolve it before closing.");
      } finally {
        release();
      }
    }
  };
  /** Remove confirmed closed identities; pending async responses cannot republish them. */
  retireScope = (scope: FileEditScope): void => {
    for (const entry of this.allEntries()) {
      if (!this.matches(entry, scope)) continue;
      entry.dispose();
      this.remove(entry);
    }
    this.notify();
  };
  /** Expose callback-only lifecycle integration without moving business state. */
  boundary(): FileEditCallbacks {
    return {
      settle: this.settle,
      save: this.save,
      hasPendingEdits: this.hasPendingEdits,
      subscribe: this.subscribe,
      retire: this.retireScope,
    };
  }

  /** Reports the current reset lifetime. */
  get lifetime(): number {
    return this.epoch;
  }

  /** Returns the one entry of a handle without issuing any request. */
  entry(fileHandleId: string): FileHandleEntry {
    const existing = this.entries.get(fileHandleId);
    if (existing !== undefined) return existing;
    const created = new FileHandleRegistryEntry(fileHandleId, this);
    this.entries.set(fileHandleId, created);
    this.evictUnused(created);
    return created;
  }

  /**
   * Starts the one shared invalidation listener plus focus recovery. No polling timer is
   * added: `pollingFallback` is a backend fact the status bar displays, not a scheduler.
   */
  startMonitoring(): void {
    if (this.monitoring) return;
    this.monitoring = true;
    window.addEventListener("focus", this.handleWindowFocus);
    const generation = ++this.monitorGeneration;
    void this.dependencies
      .onFileHandleChanged((event) => this.applyEvent(event))
      .then((unlisten) => {
        // A registration resolving after stop or restart releases itself exactly once.
        if (generation === this.monitorGeneration && this.monitoring) this.unlisten = unlisten;
        else unlisten();
      })
      // A rejected registration leaves mount queries and focus recovery working.
      .catch(() => undefined);
  }

  /** Stops provider-owned listeners without discarding retained snapshots. */
  stopMonitoring(): void {
    if (!this.monitoring) return;
    this.monitoring = false;
    this.monitorGeneration += 1;
    window.removeEventListener("focus", this.handleWindowFocus);
    this.unlisten?.();
    this.unlisten = null;
  }

  /** Drops every entry, pending read and scroll offset after a committed reset. */
  clearAfterReset(): void {
    this.epoch += 1;
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
    this.scrollTops.clear();
  }

  /** Re-reads retained entries after an uncertain reset without deleting anything. */
  reconcileAfterResetFailure(): void {
    for (const entry of this.entries.values()) entry.refreshWhenRetained();
  }

  /** Removes one retired entry and its scroll offset from every index. */
  remove(entry: FileHandleRegistryEntry): void {
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    this.scrollTops.delete(entry.id);
  }

  /** Reads the retained scroll offset of one handle. */
  scrollTop(fileHandleId: string): number {
    return this.scrollTops.get(fileHandleId) ?? 0;
  }

  /** Retains one scroll offset keyed by handle identity, never by path. */
  writeScrollTop(fileHandleId: string, value: number): void {
    this.scrollTops.set(fileHandleId, value);
  }

  /** Routes one invalidation to its owning entry and ignores unknown identities. */
  private applyEvent(event: FileHandleChangedEventDto): void {
    this.entries.get(event.fileHandleId)?.applyInvalidation(event);
  }

  /** Recovers snapshots of visible handles after a lost event; unused entries stay idle. */
  private readonly handleWindowFocus = (): void => {
    for (const entry of this.entries.values()) entry.refreshWhenRetained();
  };

  /** Enforces the entry bound by dropping unused entries only, oldest first. */
  private evictUnused(keep: FileHandleRegistryEntry): void {
    if (this.entries.size <= ENTRY_LIMIT) return;
    for (const [id, candidate] of this.entries) {
      if (this.entries.size <= ENTRY_LIMIT) return;
      if (candidate === keep || candidate.isRetained() || candidate.getSnapshot().draft !== null)
        continue;
      candidate.dispose();
      this.entries.delete(id);
      this.scrollTops.delete(id);
    }
  }
}

/** Extract Markdown text from ready or retained recovery snapshots. */
function markdownText(handle: FileHandleDto): TextFileDto | null {
  const state = handle.state;
  const file =
    state.kind === "ready"
      ? state.content.kind === "text"
        ? state.content.file
        : null
      : state.kind === "projectRootChanged"
        ? null
        : state.local;
  return file?.mode === "markdown" ? file : null;
}
