import type {
  FileEntryPathsDto,
  FileEntryRequestDto,
  FileHandleChangedEventDto,
  FileHandleDto,
  FileHandleRequestDto,
} from "@/bindings/files/files";
import {
  getFileEntryPaths,
  getOpenFile,
  onFileHandleChanged,
  openFileWithDefaultApp,
  reloadOpenFile,
} from "@/lib/ipc/files";
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
}

/** One handle retained outside the component lifetime of its panes. */
export interface FileHandleEntry {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileHandleEntryState;
  retain(): () => void;
  reload(): Promise<void>;
  openWithDefaultApp(): Promise<void>;
  copyPath(): Promise<void>;
  readScrollTop(): number;
  writeScrollTop(value: number): void;
}

/** Files-local transport seam; tests substitute fresh fakes per case. */
export interface FileHandleRegistryDependencies {
  getOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>;
  reloadOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>;
  openFileWithDefaultApp(request: FileHandleRequestDto): Promise<void>;
  onFileHandleChanged(listener: (event: FileHandleChangedEventDto) => void): Promise<() => void>;
  getFileEntryPaths(request: FileEntryRequestDto): Promise<FileEntryPathsDto>;
  writeText(text: string): Promise<void>;
}

/** Production transport: real BE-014 wrappers and the clipboard mechanism used elsewhere. */
const productionDependencies: FileHandleRegistryDependencies = {
  getOpenFile,
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

  /** Reads the retained scroll offset of this handle. */
  readScrollTop(): number {
    return this.registry.scrollTop(this.id);
  }

  /** Retains the scroll offset of this handle for a later remount. */
  writeScrollTop(value: number): void {
    this.registry.writeScrollTop(this.id, value);
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
    const announce = this.announceOnPublish;
    this.announceOnPublish = false;
    this.patch({
      handle: snapshot,
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
  }
}

/** Root registry owning every open handle independently of route and pane lifetime. */
export class FileHandleRegistry {
  readonly dependencies: FileHandleRegistryDependencies;
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
      if (candidate === keep || candidate.isRetained()) continue;
      candidate.dispose();
      this.entries.delete(id);
      this.scrollTops.delete(id);
    }
  }
}
