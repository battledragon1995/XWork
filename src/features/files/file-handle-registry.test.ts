import { afterEach, expect, it, vi } from "vitest";
import type {
  FileEntryPathsDto,
  FileEntryRequestDto,
  FileHandleChangedEventDto,
  FileHandleDto,
  FileHandleRequestDto,
} from "@/bindings/files/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { FileHandleRegistry, type FileHandleRegistryDependencies } from "./file-handle-registry";
import { deferred, handle, missingState, project, readyTextState } from "./files-test-fixture";

/** Handle identity every case reuses; a second identity exercises independent handles. */
const HANDLE_ID = handle().id;
const OTHER_ID = "66666666-6666-4666-8666-666666666666";

/** Absolute path the backend resolves freshly for each copy action. */
const PATHS: FileEntryPathsDto = {
  relativePath: "src/main.rs",
  absolutePath: "X:/isolated-fixture/src/main.rs",
};

/** Build one controllable dependency set with no native IPC and no real filesystem. */
function dependencies() {
  const listeners: Array<(event: FileHandleChangedEventDto) => void> = [];
  const unlisten = vi.fn();
  const deps = {
    getOpenFile: vi.fn(async (_request: FileHandleRequestDto) => handle()),
    reloadOpenFile: vi.fn(async (_request: FileHandleRequestDto) => handle()),
    openFileWithDefaultApp: vi.fn(
      async (_request: FileHandleRequestDto): Promise<void> => undefined,
    ),
    /** Record the registry listener and hand back a countable unsubscribe. */
    onFileHandleChanged: vi.fn(async (listener: (event: FileHandleChangedEventDto) => void) => {
      listeners.push(listener);
      return unlisten;
    }),
    getFileEntryPaths: vi.fn(async (_request: FileEntryRequestDto) => PATHS),
    writeText: vi.fn(async (_text: string): Promise<void> => undefined),
  } satisfies FileHandleRegistryDependencies;
  return {
    deps,
    unlisten,
    /** Deliver one invalidation to every registered listener. */
    emit: (event: Partial<FileHandleChangedEventDto> = {}) => {
      const payload: FileHandleChangedEventDto = {
        fileHandleId: HANDLE_ID,
        revision: "2",
        change: "reloaded",
        ...event,
      };
      for (const listener of listeners) listener(payload);
    },
    /** Report how many listeners the registry currently keeps registered. */
    listenerCount: () => listeners.length,
  };
}

/** Let queued microtasks settle without wall-clock waiting. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/** Build one registry plus a monitored listener seam for each case. */
async function monitored() {
  const fixture = dependencies();
  const registry = new FileHandleRegistry(fixture.deps);
  registry.startMonitoring();
  await settle();
  return { ...fixture, registry };
}

/** Build one tagged backend rejection without touching native transport. */
function ipcError(code: string): IpcCallError<{ code: string }> {
  return new IpcCallError("get_open_file", { code });
}

// Restore real timers so a fake-timer case cannot leak into later cases.
afterEach(() => {
  vi.useRealTimers();
});

// Header and body of one pane share exactly one first read and one snapshot object.
it("issues one read for two consumers of the same handle", async () => {
  const { registry, deps } = await monitored();
  const header = registry.entry(HANDLE_ID);
  const body = registry.entry(HANDLE_ID);
  expect(body).toBe(header);

  const releaseHeader = header.retain();
  const releaseBody = body.retain();
  await settle();

  expect(deps.getOpenFile).toHaveBeenCalledExactlyOnceWith({ fileHandleId: HANDLE_ID });
  expect(header.getSnapshot()).toBe(body.getSnapshot());
  expect(header.getSnapshot().phase).toBe("ready");
  expect(header.getSnapshot().handle?.revision).toBe("1");
  releaseHeader();
  releaseBody();
});

// Reading an entry is a render-safe lookup, so no request may leave before retention.
it("issues no request while only looking up an entry", async () => {
  const { registry, deps } = await monitored();
  registry.entry(HANDLE_ID);
  registry.entry(HANDLE_ID);
  await settle();
  expect(deps.getOpenFile).not.toHaveBeenCalled();
});

// useSyncExternalStore requires stable callbacks and a cached snapshot between renders.
it("keeps subscribe and getSnapshot stable and notifies on publication", async () => {
  const { registry } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const notify = vi.fn();
  const unsubscribe = entry.subscribe(notify);
  expect(entry.getSnapshot).toBe(registry.entry(HANDLE_ID).getSnapshot);
  expect(entry.subscribe).toBe(registry.entry(HANDLE_ID).subscribe);
  expect(entry.getSnapshot()).toBe(entry.getSnapshot());

  const release = entry.retain();
  await settle();
  expect(notify).toHaveBeenCalled();
  unsubscribe();
  const before = entry.getSnapshot();
  notify.mockClear();
  await entry.reload();
  expect(notify).not.toHaveBeenCalled();
  expect(entry.getSnapshot()).not.toBe(before);
  release();
});

// A cached snapshot survives zero references so returning to a tab costs no command.
it("re-retains a cached ready entry without querying again", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();
  release();

  expect(registry.entry(HANDLE_ID)).toBe(entry);
  const again = entry.retain();
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
  expect(entry.getSnapshot().phase).toBe("ready");
  again();
});

// The bound drops only unused entries; a retained entry must survive the pressure.
it("evicts only unused entries above the bound", async () => {
  const { registry } = await monitored();
  const first = registry.entry("handle-0");
  const retained = registry.entry("handle-1");
  const release = retained.retain();
  await settle();

  for (let index = 2; index <= 80; index += 1) registry.entry(`handle-${index}`);

  expect(registry.entry("handle-1")).toBe(retained);
  expect(registry.entry("handle-0")).not.toBe(first);
  release();
});

// Two panes of one path own independent handles and never share a scroll offset.
it("stores scroll positions per handle identity, not per path", async () => {
  const { registry } = await monitored();
  const left = registry.entry(HANDLE_ID);
  const right = registry.entry(OTHER_ID);
  left.writeScrollTop(420);
  expect(left.readScrollTop()).toBe(420);
  expect(right.readScrollTop()).toBe(0);
});

// Unknown identities belong to another window or an already closed pane.
it("ignores invalidations for handles it does not own", async () => {
  const { registry, deps, emit } = await monitored();
  const release = registry.entry(HANDLE_ID).retain();
  await settle();
  emit({ fileHandleId: OTHER_ID, revision: "9" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
  release();
});

// A revision that is not newer would only make the viewer flicker.
it("ignores invalidations whose revision is not newer", async () => {
  const { registry, deps, emit } = await monitored();
  const release = registry.entry(HANDLE_ID).retain();
  await settle();
  emit({ revision: "1" });
  emit({ revision: "0" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
  release();
});

// Revisions are decimal strings, so `10` is newer than `9` even though it sorts earlier.
it("treats revision 10 as newer than revision 9", async () => {
  const { registry, deps, emit } = await monitored();
  deps.getOpenFile.mockResolvedValue(handle({ revision: "9" }));
  const release = registry.entry(HANDLE_ID).retain();
  await settle();
  deps.getOpenFile.mockResolvedValueOnce(handle({ revision: "10" }));
  emit({ revision: "10" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);
  expect(registry.entry(HANDLE_ID).getSnapshot().handle?.revision).toBe("10");
  release();
});

// Revisions can pass the safe integer range, so comparison must use BigInt.
it("compares revisions beyond the safe integer range", async () => {
  const { registry, deps, emit } = await monitored();
  deps.getOpenFile.mockResolvedValue(handle({ revision: "9007199254740993" }));
  const release = registry.entry(HANDLE_ID).retain();
  await settle();

  emit({ revision: "9007199254740992" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();

  deps.getOpenFile.mockResolvedValueOnce(handle({ revision: "9007199254740994" }));
  emit({ revision: "9007199254740994" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);
  expect(registry.entry(HANDLE_ID).getSnapshot().handle?.revision).toBe("9007199254740994");
  release();
});

// A burst already covered by the completed snapshot must not queue another read.
it("coalesces a burst covered by the completed snapshot", async () => {
  const { registry, deps, emit } = await monitored();
  deps.getOpenFile.mockResolvedValueOnce(handle({ revision: "1" }));
  const release = registry.entry(HANDLE_ID).retain();
  await settle();

  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  emit({ revision: "2" });
  emit({ revision: "3" });
  emit({ revision: "4" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);

  pending.resolve(handle({ revision: "4" }));
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);
  expect(registry.entry(HANDLE_ID).getSnapshot().handle?.revision).toBe("4");
  release();
});

// A newer invalidation behind an older in-flight read needs exactly one follow-up read.
it("follows an older in-flight read with exactly one newer read", async () => {
  const { registry, deps, emit } = await monitored();
  deps.getOpenFile.mockResolvedValueOnce(handle({ revision: "1" }));
  const release = registry.entry(HANDLE_ID).retain();
  await settle();

  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  emit({ revision: "2" });
  await settle();
  emit({ revision: "3" });
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);

  deps.getOpenFile.mockResolvedValueOnce(handle({ revision: "3" }));
  pending.resolve(handle({ revision: "2" }));
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(3);
  expect(registry.entry(HANDLE_ID).getSnapshot().handle?.revision).toBe("3");

  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(3);
  release();
});

// A late response from an older read must never replace a newer published snapshot.
it("never publishes an older read over a newer snapshot", async () => {
  const { registry, deps } = await monitored();
  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  deps.reloadOpenFile.mockResolvedValueOnce(handle({ revision: "5" }));
  await entry.reload();
  expect(entry.getSnapshot().handle?.revision).toBe("5");

  pending.resolve(handle({ revision: "1" }));
  await settle();
  expect(entry.getSnapshot().handle?.revision).toBe("5");
  release();
});

// Window focus is the recovery path for a lost event and touches only visible handles.
it("refreshes retained entries on window focus and skips unused ones", async () => {
  const { registry, deps } = await monitored();
  const retained = registry.entry(HANDLE_ID);
  const release = retained.retain();
  const unused = registry.entry(OTHER_ID);
  const temporary = unused.retain();
  await settle();
  temporary();
  deps.getOpenFile.mockClear();

  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledExactlyOnceWith({ fileHandleId: HANDLE_ID });
  release();
});

// Focus recovery must join a pending read instead of duplicating it.
it("coalesces focus recovery with a pending read", async () => {
  const { registry, deps } = await monitored();
  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  const release = registry.entry(HANDLE_ID).retain();
  await settle();

  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
  pending.resolve(handle());
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
  release();
});

// Change detection stays backend-owned; the frontend adds no polling timer at all.
it("adds no polling timer", async () => {
  vi.useFakeTimers();
  const fixture = dependencies();
  const registry = new FileHandleRegistry(fixture.deps);
  registry.startMonitoring();
  const release = registry.entry(HANDLE_ID).retain();
  await settle();
  expect(fixture.deps.getOpenFile).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(300_000);
  await settle();
  expect(fixture.deps.getOpenFile).toHaveBeenCalledOnce();
  release();
  registry.stopMonitoring();
});

// Stopping monitoring releases exactly one subscription and starting twice adds none.
it("registers one listener and unsubscribes once", async () => {
  const { registry, unlisten, listenerCount } = await monitored();
  registry.startMonitoring();
  await settle();
  expect(listenerCount()).toBe(1);
  registry.stopMonitoring();
  expect(unlisten).toHaveBeenCalledOnce();
});

// One click may only send one reload command.
it("guards reload against a second concurrent command", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  const pending = deferred<FileHandleDto>();
  deps.reloadOpenFile.mockReturnValueOnce(pending.promise);
  const first = entry.reload();
  await entry.reload();
  expect(deps.reloadOpenFile).toHaveBeenCalledOnce();
  expect(entry.getSnapshot().isReloading).toBe(true);

  pending.resolve(handle({ revision: "3" }));
  await first;
  expect(entry.getSnapshot().isReloading).toBe(false);
  expect(entry.getSnapshot().announcement).toBe("File reloaded from disk.");
  expect(entry.getSnapshot().handle?.revision).toBe("3");
  release();
});

// A recoverable reload failure keeps the previously read content on screen.
it("keeps old content after a recoverable reload failure", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  deps.reloadOpenFile.mockRejectedValueOnce(ipcError("fileReadFailed"));
  await entry.reload();
  expect(entry.getSnapshot().handle?.revision).toBe("1");
  expect(entry.getSnapshot().phase).toBe("failed");
  expect(entry.getSnapshot().failureCode).toBe("fileReadFailed");
  expect(entry.getSnapshot().failure).toBe("Could not read this file.");
  release();
});

// A retired handle is terminal: it leaves the registry but keeps rendering its failure.
it.each(["invalidFileHandleId", "fileHandleNotFound"])(
  "retires the entry after %s",
  async (code) => {
    const { registry, deps } = await monitored();
    deps.getOpenFile.mockRejectedValueOnce(ipcError(code));
    const entry = registry.entry(HANDLE_ID);
    const notify = vi.fn();
    entry.subscribe(notify);
    const release = entry.retain();
    await settle();

    expect(entry.getSnapshot().phase).toBe("failed");
    expect(entry.getSnapshot().failureCode).toBe(code);
    expect(notify).toHaveBeenCalled();
    expect(registry.entry(HANDLE_ID)).not.toBe(entry);
    release();
  },
);

// A stale callback of a retired entry must not resurrect it in the registry.
it("keeps a retired entry out of the registry after a late callback", async () => {
  const { registry, deps } = await monitored();
  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  deps.reloadOpenFile.mockRejectedValueOnce(ipcError("fileHandleNotFound"));
  await entry.reload();
  const replacement = registry.entry(HANDLE_ID);
  expect(replacement).not.toBe(entry);

  pending.resolve(handle({ revision: "7" }));
  await settle();
  expect(entry.getSnapshot().phase).toBe("failed");
  expect(entry.getSnapshot().handle?.revision).not.toBe("7");
  expect(registry.entry(HANDLE_ID)).toBe(replacement);
  release();
});

// A read rejection stays retryable, and the retry publishes the authoritative snapshot.
it("retries a rejected read on demand", async () => {
  const { registry, deps } = await monitored();
  deps.getOpenFile.mockRejectedValueOnce(ipcError("fileReadFailed"));
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();
  expect(entry.getSnapshot().phase).toBe("failed");
  expect(entry.getSnapshot().handle).toBeNull();

  deps.reloadOpenFile.mockResolvedValueOnce(handle({ state: missingState() }));
  await entry.reload();
  expect(entry.getSnapshot().phase).toBe("ready");
  expect(entry.getSnapshot().failure).toBeNull();
  expect(entry.getSnapshot().handle?.state.kind).toBe("missing");
  release();
});

// One click may only send one external-open command, and rejection stays visible.
it("guards the external opener and reports its failure", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  const pending = deferred<void>();
  deps.openFileWithDefaultApp.mockReturnValueOnce(pending.promise);
  const first = entry.openWithDefaultApp();
  await entry.openWithDefaultApp();
  expect(deps.openFileWithDefaultApp).toHaveBeenCalledExactlyOnceWith({
    fileHandleId: HANDLE_ID,
  });
  expect(entry.getSnapshot().externalPending).toBe(true);
  pending.resolve();
  await first;
  expect(entry.getSnapshot().externalPending).toBe(false);

  deps.openFileWithDefaultApp.mockRejectedValueOnce(ipcError("openExternalFailed"));
  await entry.openWithDefaultApp();
  expect(entry.getSnapshot().externalFailure).toBe(
    "Could not open this file with the default app.",
  );
  expect(entry.getSnapshot().externalPending).toBe(false);
  release();
});

// Path and root failures of the opener mean the retained snapshot is stale.
it.each(["entryNotFound", "linkTraversalDenied", "projectRootChanged"])(
  "re-reads the snapshot after opener error %s",
  async (code) => {
    const { registry, deps } = await monitored();
    const entry = registry.entry(HANDLE_ID);
    const release = entry.retain();
    await settle();
    deps.getOpenFile.mockClear();

    deps.openFileWithDefaultApp.mockRejectedValueOnce(ipcError(code));
    await entry.openWithDefaultApp();
    await settle();
    expect(deps.getOpenFile).toHaveBeenCalledOnce();
    release();
  },
);

// Copy resolves a fresh path first and only announces after the clipboard write completes.
it("copies a freshly resolved path and announces after writing", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  const pending = deferred<void>();
  deps.writeText.mockReturnValueOnce(pending.promise);
  const copying = entry.copyPath();
  await settle();
  expect(deps.getFileEntryPaths).toHaveBeenCalledExactlyOnceWith({
    projectId: project.id,
    relativePath: "src/main.rs",
  });
  expect(deps.writeText).toHaveBeenCalledExactlyOnceWith(PATHS.absolutePath);
  expect(entry.getSnapshot().copyFeedback).toBe("");

  pending.resolve();
  await copying;
  expect(entry.getSnapshot().copyFeedback).toBe("Path copied.");
  release();
});

// A rejected clipboard write can never announce success.
it("reports a rejected clipboard write without success copy", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  deps.writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
  await entry.copyPath();
  expect(entry.getSnapshot().copyFeedback).toBe("Could not copy path. Try again.");
  release();
});

// A path lookup that fails on availability explains the entry rather than the clipboard.
it("reports an unavailable entry when the path lookup fails", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  deps.getFileEntryPaths.mockRejectedValueOnce(ipcError("entryNotFound"));
  await entry.copyPath();
  expect(deps.writeText).not.toHaveBeenCalled();
  expect(entry.getSnapshot().copyFeedback).toBe("This entry is no longer available.");
  release();
});

// Between the path lookup and the clipboard write the entry can lose its lifetime.
it("suppresses copy feedback when the lifetime ends between awaits", async () => {
  const { registry, deps } = await monitored();
  const entry = registry.entry(HANDLE_ID);
  const release = entry.retain();
  await settle();

  const pending = deferred<FileEntryPathsDto>();
  deps.getFileEntryPaths.mockReturnValueOnce(pending.promise);
  const copying = entry.copyPath();
  registry.clearAfterReset();
  pending.resolve(PATHS);
  await copying;
  expect(deps.writeText).not.toHaveBeenCalled();
  expect(entry.getSnapshot().copyFeedback).toBe("");
  release();
});

// A committed reset retires pending work, entries and scroll state together.
it("clears entries, scroll state and pending work after a committed reset", async () => {
  const { registry, deps } = await monitored();
  const pending = deferred<FileHandleDto>();
  deps.getOpenFile.mockReturnValueOnce(pending.promise);
  const entry = registry.entry(HANDLE_ID);
  const notify = vi.fn();
  entry.subscribe(notify);
  const release = entry.retain();
  entry.writeScrollTop(120);
  await settle();

  registry.clearAfterReset();
  notify.mockClear();
  pending.resolve(handle({ revision: "8" }));
  await settle();

  expect(entry.getSnapshot().handle).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  const replacement = registry.entry(HANDLE_ID);
  expect(replacement).not.toBe(entry);
  expect(replacement.readScrollTop()).toBe(0);
  release();
});

// An uncertain reset may not delete anything; it only re-reads what is still visible.
it("re-reads retained entries after an uncertain reset without deleting them", async () => {
  const { registry, deps } = await monitored();
  const retained = registry.entry(HANDLE_ID);
  const release = retained.retain();
  const unused = registry.entry(OTHER_ID);
  const temporary = unused.retain();
  await settle();
  temporary();
  deps.getOpenFile.mockClear();

  registry.reconcileAfterResetFailure();
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledExactlyOnceWith({ fileHandleId: HANDLE_ID });
  expect(registry.entry(HANDLE_ID)).toBe(retained);
  expect(registry.entry(OTHER_ID)).toBe(unused);
  release();
});

// Invalidations arriving after a committed reset belong to a retired lifetime.
it("ignores invalidations for a lifetime that a reset already retired", async () => {
  const { registry, deps, emit } = await monitored();
  const release = registry.entry(HANDLE_ID).retain();
  await settle();
  registry.clearAfterReset();
  deps.getOpenFile.mockClear();

  emit({ revision: "12" });
  window.dispatchEvent(new Event("focus"));
  await settle();
  expect(deps.getOpenFile).not.toHaveBeenCalled();
  release();
});

// Two panes of the same path own independent snapshots and independent reads.
it("keeps handles of the same path independent", async () => {
  const { registry, deps, emit } = await monitored();
  deps.getOpenFile.mockImplementation(async (request) =>
    handle({ id: request.fileHandleId, revision: "1" }),
  );
  const left = registry.entry(HANDLE_ID);
  const right = registry.entry(OTHER_ID);
  const releaseLeft = left.retain();
  const releaseRight = right.retain();
  await settle();
  expect(deps.getOpenFile).toHaveBeenCalledTimes(2);

  deps.getOpenFile.mockClear();
  deps.getOpenFile.mockImplementation(async (request) =>
    handle({ id: request.fileHandleId, revision: "4", state: readyTextState({ text: "changed" }) }),
  );
  emit({ fileHandleId: OTHER_ID, revision: "4" });
  await settle();

  expect(deps.getOpenFile).toHaveBeenCalledExactlyOnceWith({ fileHandleId: OTHER_ID });
  expect(left.getSnapshot().handle?.revision).toBe("1");
  expect(right.getSnapshot().handle?.revision).toBe("4");
  releaseLeft();
  releaseRight();
});
