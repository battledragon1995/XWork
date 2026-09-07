import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRuntimeTarget,
  createTab,
  getCloseImpact,
  setActivePane,
  splitPane,
} from "@/lib/ipc/sessions";
import {
  createCloseImpact,
  createNonEmptySessionDetail,
  createPaneDto,
  createSplitLayout,
  createTabCloseTarget,
  createTabDto,
  FIXTURE_SESSION_ID,
} from "./sessions-test-fixture";
import { useWorkspaceMutations } from "./use-workspace-mutations";

vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  createTab: vi.fn(),
  getCloseImpact: vi.fn(),
  moveTab: vi.fn(),
  renameTab: vi.fn(),
  reopenLastClosedTab: vi.fn(),
  selectPaneTool: vi.fn(),
  setActivePane: vi.fn(),
  setActiveTab: vi.fn(),
  setMaximizedPane: vi.fn(),
  setSplitRatio: vi.fn(),
  splitPane: vi.fn(),
}));

const createTabMock = vi.mocked(createTab);
const getCloseImpactMock = vi.mocked(getCloseImpact);
const closeRuntimeTargetMock = vi.mocked(closeRuntimeTarget);
const splitPaneMock = vi.mocked(splitPane);
const setActivePaneMock = vi.mocked(setActivePane);

/** Build one externally controlled promise for concurrency assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** Build one occupied pane, which is never a valid file attachment target. */
function occupiedPane(id: string) {
  return createPaneDto({
    id,
    content: { kind: "toolSelection", profileId: "builtin:codex", title: "Codex" },
  });
}

describe("useWorkspaceMutations", () => {
  beforeEach(() => vi.resetAllMocks());

  // Verify the structural slot drops a rapid duplicate and applies only returned snapshots.
  it("serializes structural operations", async () => {
    const detail = createNonEmptySessionDetail();
    const pending = deferred<typeof detail>();
    createTabMock.mockReturnValue(pending.promise);
    const onApplyDetail = vi.fn();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail, onRefresh: vi.fn() }),
    );
    let first!: Promise<void>;
    await act(async () => {
      first = view.result.current.createTab();
      await view.result.current.createTab();
    });
    expect(createTabMock).toHaveBeenCalledOnce();
    pending.resolve(detail);
    await act(async () => first);
    expect(onApplyDetail).toHaveBeenCalledWith(detail);
  });

  // Verify every close inspects first and a blocker-free target closes without a dialog.
  it("inspects then closes a blocker-free tab", async () => {
    const detail = createNonEmptySessionDetail();
    const target = createTabCloseTarget();
    getCloseImpactMock.mockResolvedValue(
      createCloseImpact({ target, requiresConfirmation: false }),
    );
    closeRuntimeTargetMock.mockResolvedValue({ target, session: detail });
    const onApplyDetail = vi.fn();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail, onRefresh: vi.fn() }),
    );
    await act(async () => view.result.current.requestClose(target));
    expect(getCloseImpactMock).toHaveBeenCalledWith(target);
    expect(closeRuntimeTargetMock).toHaveBeenCalledWith(target, false);
    expect(view.result.current.pendingClose).toBeNull();
    expect(onApplyDetail).toHaveBeenCalledWith(detail);
  });

  // Verify a first file tab is created and its authoritative empty pane is returned.
  it("prepares a new tab target from the command result", async () => {
    const detail = createNonEmptySessionDetail();
    const createdTab = createTabDto({
      id: "tab-2",
      layout: { kind: "pane", pane: createPaneDto({ id: "pane-new" }) },
      activePaneId: "pane-new",
    });
    const applied = createNonEmptySessionDetail({
      tabs: [...detail.tabs, createdTab],
      activeTabId: createdTab.id,
      revision: "12",
    });
    createTabMock.mockResolvedValue(applied);
    const onApplyDetail = vi.fn();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail, onRefresh: vi.fn() }),
    );

    let target: unknown;
    await act(async () => {
      target = await view.result.current.prepareFileTarget("newTab");
    });

    expect(createTabMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID);
    expect(onApplyDetail).toHaveBeenCalledWith(applied);
    expect(target).toEqual({ tabId: "tab-2", paneId: "pane-new" });
  });

  // Verify an existing empty leaf is activated rather than a second pane being created.
  it("prepares the first empty pane of the active tab", async () => {
    const tab = createTabDto({
      layout: createSplitLayout({
        first: { kind: "pane", pane: occupiedPane("pane-tool") },
        second: { kind: "pane", pane: createPaneDto({ id: "pane-empty" }) },
      }),
      activePaneId: "pane-tool",
    });
    const detail = createNonEmptySessionDetail({ tabs: [tab], activeTabId: tab.id });
    setActivePaneMock.mockResolvedValue({ ...detail, revision: "12" });
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail: vi.fn(), onRefresh: vi.fn() }),
    );

    let target: unknown;
    await act(async () => {
      target = await view.result.current.prepareFileTarget("emptyPane");
    });

    expect(setActivePaneMock).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_SESSION_ID,
      tab.id,
      "pane-empty",
    );
    expect(createTabMock).not.toHaveBeenCalled();
    expect(target).toEqual({ tabId: tab.id, paneId: "pane-empty" });
  });

  // Verify a split target is the pane the command actually added, not a guessed identifier.
  it.each([
    { placement: "splitRight" as const, direction: "right" },
    { placement: "splitDown" as const, direction: "down" },
  ])("prepares a $placement target", async ({ placement, direction }) => {
    const detail = createNonEmptySessionDetail();
    const activeTab = detail.tabs[0];
    if (activeTab === undefined) throw new Error("fixture must have one tab");
    const splitTab = createTabDto({
      id: activeTab.id,
      layout: createSplitLayout({
        first: { kind: "pane", pane: occupiedPane(activeTab.activePaneId) },
        second: { kind: "pane", pane: createPaneDto({ id: "pane-split" }) },
      }),
      activePaneId: "pane-split",
    });
    const applied = createNonEmptySessionDetail({
      tabs: [splitTab],
      activeTabId: splitTab.id,
      revision: "12",
    });
    splitPaneMock.mockResolvedValue(applied);
    const onApplyDetail = vi.fn();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail, onRefresh: vi.fn() }),
    );

    let target: unknown;
    await act(async () => {
      target = await view.result.current.prepareFileTarget(placement);
    });

    expect(splitPaneMock).toHaveBeenCalledExactlyOnceWith(
      FIXTURE_SESSION_ID,
      activeTab.id,
      activeTab.activePaneId,
      direction,
    );
    expect(onApplyDetail).toHaveBeenCalledWith(applied);
    expect(target).toEqual({ tabId: activeTab.id, paneId: "pane-split" });
  });

  // Verify a refused placement never reaches a command and never invents a target.
  it("refuses placements the current snapshot cannot satisfy", async () => {
    const detail = createNonEmptySessionDetail();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail: vi.fn(), onRefresh: vi.fn() }),
    );

    let emptyTarget: unknown = "unset";
    await act(async () => {
      // The fixture tab holds one occupied pane, so no empty leaf can be activated.
      emptyTarget = await view.result.current.prepareFileTarget("emptyPane");
    });

    expect(emptyTarget).toBeNull();
    expect(setActivePaneMock).not.toHaveBeenCalled();
    expect(view.result.current.filePlacements).toEqual({
      newTab: true,
      emptyPane: false,
      splitRight: true,
      splitDown: true,
    });
  });

  // Verify a full tab and an empty session expose exactly the placements FE-017 allows.
  it.each([
    {
      label: "a four-pane tab",
      build: () => {
        const tab = createTabDto({
          layout: createSplitLayout({
            first: createSplitLayout({
              splitId: "split-2",
              first: { kind: "pane", pane: occupiedPane("pane-1") },
              second: { kind: "pane", pane: occupiedPane("pane-2") },
            }),
            second: createSplitLayout({
              splitId: "split-3",
              first: { kind: "pane", pane: occupiedPane("pane-3") },
              second: { kind: "pane", pane: occupiedPane("pane-4") },
            }),
          }),
          activePaneId: "pane-1",
        });
        return createNonEmptySessionDetail({ tabs: [tab], activeTabId: tab.id });
      },
      expected: { newTab: true, emptyPane: false, splitRight: false, splitDown: false },
    },
    {
      label: "a session with no tab",
      build: () => createNonEmptySessionDetail({ tabs: [], activeTabId: null }),
      expected: { newTab: true, emptyPane: false, splitRight: false, splitDown: false },
    },
  ])("derives placements for $label", async ({ build, expected }) => {
    const snapshot = build();
    const view = renderHook(() =>
      useWorkspaceMutations({ detail: snapshot, onApplyDetail: vi.fn(), onRefresh: vi.fn() }),
    );

    expect(view.result.current.filePlacements).toEqual(expected);

    let target: unknown = "unset";
    await act(async () => {
      target = await view.result.current.prepareFileTarget("splitRight");
    });
    expect(target).toBeNull();
    expect(splitPaneMock).not.toHaveBeenCalled();
  });

  // Verify a failed preparation reports through Sessions and never repeats the command.
  it("returns null and publishes the failure when the command is rejected", async () => {
    const detail = createNonEmptySessionDetail();
    createTabMock.mockRejectedValue({ code: "projectLookupFailed" });
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail: vi.fn(), onRefresh: vi.fn() }),
    );

    let target: unknown = "unset";
    await act(async () => {
      target = await view.result.current.prepareFileTarget("newTab");
    });

    expect(target).toBeNull();
    expect(view.result.current.failure).not.toBeNull();

    await act(async () => view.result.current.retryFailure());

    // Repeating it would create an orphan tab for an opening intent that no longer exists.
    expect(createTabMock).toHaveBeenCalledOnce();
  });

  // Verify a preparation cannot start while another structural command owns the slot.
  it("refuses preparation while the mutation slot is busy", async () => {
    const detail = createNonEmptySessionDetail();
    const pending = deferred<typeof detail>();
    createTabMock.mockReturnValue(pending.promise);
    const view = renderHook(() =>
      useWorkspaceMutations({ detail, onApplyDetail: vi.fn(), onRefresh: vi.fn() }),
    );

    let first!: Promise<void>;
    let target: unknown = "unset";
    await act(async () => {
      first = view.result.current.createTab();
      target = await view.result.current.prepareFileTarget("newTab");
    });

    expect(target).toBeNull();
    expect(createTabMock).toHaveBeenCalledOnce();
    pending.resolve(detail);
    await act(async () => first);
  });
});
