import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { FileHandleChangedEventDto } from "@/bindings/files/files";
import { useFileDataBoundary, useFileHandleRegistry } from "./file-handle-context";
import { FileHandleProvider } from "./file-handle-provider";
import { FileHandleRegistry, type FileHandleRegistryDependencies } from "./file-handle-registry";
import { deferred, handle } from "./files-test-fixture";

// Unmount every rendered tree so one case cannot observe another case's DOM or listeners.
afterEach(() => {
  cleanup();
});

/** Handle identity the mounted consumer retains in every case. */
const HANDLE_ID = handle().id;

/** Build one controllable dependency set whose listeners can be counted while live. */
function dependencies(
  register?: (listener: (event: FileHandleChangedEventDto) => void) => Promise<() => void>,
) {
  const listeners: Array<(event: FileHandleChangedEventDto) => void> = [];
  let unlistenCalls = 0;
  const deps = {
    getOpenFile: vi.fn(async () => handle()),
    reloadOpenFile: vi.fn(async () => handle()),
    openFileWithDefaultApp: vi.fn(async (): Promise<void> => undefined),
    /** Track live listeners so a duplicate registration is observable. */
    onFileHandleChanged: vi.fn(async (listener: (event: FileHandleChangedEventDto) => void) => {
      if (register !== undefined) return register(listener);
      listeners.push(listener);
      return () => {
        unlistenCalls += 1;
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    getFileEntryPaths: vi.fn(async () => ({
      relativePath: "src/main.rs",
      absolutePath: "X:/isolated-fixture/src/main.rs",
    })),
    writeText: vi.fn(async (): Promise<void> => undefined),
  } satisfies FileHandleRegistryDependencies;
  return {
    deps,
    /** Report how many listeners are currently subscribed. */
    liveListeners: () => listeners.length,
    /** Report how many unsubscribe callbacks ran. */
    unlistenCalls: () => unlistenCalls,
  };
}

/** Mount one pane-like consumer that retains the handle exactly like FilePane will. */
function Viewer() {
  const registry = useFileHandleRegistry();
  const entry = registry.entry(HANDLE_ID);
  const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
  // Retention belongs to an effect so no request is issued during React render.
  useEffect(() => entry.retain(), [entry]);
  return <p>{state.handle?.revision ?? "loading"}</p>;
}

/** Expose the maintenance hook so a test can drive both reset branches. */
function Maintenance(props: { onReady(actions: ReturnType<typeof useFileDataBoundary>): void }) {
  const actions = useFileDataBoundary();
  props.onReady(actions);
  return null;
}

// One registry must outlive re-renders so panes keep their retained snapshots.
it("constructs the registry once and shares it through context", async () => {
  const { deps } = dependencies();
  const create = vi.fn(() => new FileHandleRegistry(deps));
  const view = render(
    <FileHandleProvider createRegistry={create}>
      <Viewer />
    </FileHandleProvider>,
  );
  await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

  view.rerender(
    <FileHandleProvider createRegistry={create}>
      <Viewer />
    </FileHandleProvider>,
  );
  expect(create).toHaveBeenCalledOnce();
  expect(deps.getOpenFile).toHaveBeenCalledOnce();
});

// The shared invalidation subscription is owned by the provider lifetime.
it("subscribes on mount and unsubscribes on unmount", async () => {
  const fixture = dependencies();
  const view = render(
    <FileHandleProvider createRegistry={() => new FileHandleRegistry(fixture.deps)}>
      <Viewer />
    </FileHandleProvider>,
  );
  await waitFor(() => expect(fixture.liveListeners()).toBe(1));

  view.unmount();
  expect(fixture.liveListeners()).toBe(0);
  expect(fixture.unlistenCalls()).toBe(1);
});

// A rejected registration must leave the pane working through query and focus recovery.
it("keeps panes working when listener registration fails", async () => {
  const { deps } = dependencies(() => Promise.reject(new Error("listen denied")));
  render(
    <FileHandleProvider createRegistry={() => new FileHandleRegistry(deps)}>
      <Viewer />
    </FileHandleProvider>,
  );
  await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
  expect(deps.getOpenFile).toHaveBeenCalledOnce();

  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(deps.getOpenFile).toHaveBeenCalledTimes(2));
});

// A registration resolving after unmount must release its subscription exactly once.
it("unsubscribes exactly once when registration resolves after unmount", async () => {
  let unlistenCalls = 0;
  const pending = deferred<() => void>();
  const { deps } = dependencies(() => pending.promise);
  const view = render(
    <FileHandleProvider createRegistry={() => new FileHandleRegistry(deps)}>
      <Viewer />
    </FileHandleProvider>,
  );
  await waitFor(() => expect(deps.onFileHandleChanged).toHaveBeenCalledOnce());

  view.unmount();
  pending.resolve(() => {
    unlistenCalls += 1;
  });
  await waitFor(() => expect(unlistenCalls).toBe(1));
  await Promise.resolve();
  expect(unlistenCalls).toBe(1);
});

// React development remounts must not leave a second live subscription behind.
it("leaves no duplicate listener after a StrictMode remount", async () => {
  const fixture = dependencies();
  const view = render(
    <StrictMode>
      <FileHandleProvider createRegistry={() => new FileHandleRegistry(fixture.deps)}>
        <Viewer />
      </FileHandleProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
  await waitFor(() => expect(fixture.liveListeners()).toBe(1));

  view.unmount();
  expect(fixture.liveListeners()).toBe(0);
});

// Data-management boundary actions must reach the same registry the panes read.
it("routes maintenance actions to the mounted registry", async () => {
  const { deps } = dependencies();
  const registry = new FileHandleRegistry(deps);
  const clear = vi.spyOn(registry, "clearAfterReset");
  const reconcile = vi.spyOn(registry, "reconcileAfterResetFailure");
  const captured: { actions: ReturnType<typeof useFileDataBoundary> | null } = { actions: null };
  render(
    <FileHandleProvider createRegistry={() => registry}>
      <Maintenance
        onReady={(value) => {
          captured.actions = value;
        }}
      />
    </FileHandleProvider>,
  );

  await waitFor(() => expect(captured.actions).not.toBeNull());
  captured.actions?.clearAfterReset();
  captured.actions?.reconcileAfterResetFailure();
  expect(clear).toHaveBeenCalledOnce();
  expect(reconcile).toHaveBeenCalledOnce();
});

// Composition mistakes must fail loudly instead of silently dropping every snapshot.
it("fails clearly without a provider", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => render(<Viewer />)).toThrow("FileHandleProvider is missing from app composition.");
  error.mockRestore();
});
