import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeRuntimeTarget, createTab, getCloseImpact } from "@/lib/ipc/sessions";
import {
  createCloseImpact,
  createNonEmptySessionDetail,
  createTabCloseTarget,
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

/** Build one externally controlled promise for concurrency assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
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
});
