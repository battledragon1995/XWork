import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CloseImpactDto,
  CloseTargetDto,
  SessionDetailDto,
  SplitDirectionDto,
} from "@/bindings/sessions/sessions";
import {
  closeRuntimeTarget,
  createTab,
  getCloseImpact,
  moveTab,
  renameTab,
  reopenLastClosedTab,
  selectPaneTool,
  setActivePane,
  setActiveTab,
  setMaximizedPane,
  setSplitRatio,
  splitPane,
} from "@/lib/ipc/sessions";
import {
  classifySessionsFailure,
  PANE_LIMIT_MESSAGE,
  type SessionsFailure,
  sessionsErrorOf,
} from "@/lib/utils/session-copy";
import { recordToolUse } from "./recent-tools-store";
import {
  clampRatioBasisPoints,
  countPanes,
  PANE_LIMIT,
  resolveMoveBeforeTabId,
} from "./session-layout";

/** Structural operations that share the workspace's single mutation slot. */
export type WorkspaceOperation =
  | "createTab"
  | "renameTab"
  | "moveTab"
  | "splitPane"
  | "maximizePane"
  | "selectPaneTool"
  | "reopenTab"
  | "inspectClose"
  | "close";

/** One inspected close target waiting for explicit confirmation. */
export interface PendingClose {
  target: CloseTargetDto;
  impact: CloseImpactDto;
  isLastPaneOfTab: boolean;
}

/** Public state and actions used by the sessions-local workspace components. */
export interface WorkspaceMutations {
  pending: WorkspaceOperation | null;
  failure: SessionsFailure | null;
  isSessionClosing: boolean;
  pendingClose: PendingClose | null;
  createTab(): Promise<void>;
  renameTab(tabId: string, name: string): Promise<boolean>;
  moveTab(tabId: string, toIndex: number): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  activatePane(tabId: string, paneId: string): Promise<void>;
  splitPane(tabId: string, paneId: string, direction: SplitDirectionDto): Promise<void>;
  commitSplitRatio(tabId: string, splitId: string, ratioBasisPoints: number): Promise<void>;
  toggleMaximizedPane(tabId: string, paneId: string): Promise<void>;
  selectPaneTool(tabId: string, paneId: string, profileId: string): Promise<void>;
  reopenLastClosedTab(): Promise<void>;
  requestClose(target: CloseTargetDto): Promise<void>;
  confirmClose(): Promise<void>;
  cancelClose(): void;
  clearFailure(): void;
  retryFailure(): Promise<void>;
}

/** Inputs that keep backend snapshots owned by the route. */
export interface UseWorkspaceMutationsOptions {
  detail: SessionDetailDto;
  onApplyDetail(detail: SessionDetailDto): void;
  onRefresh(): void;
  onProfileUnavailable?(profileId: string): void;
  onCatalogRefresh?(): void;
  onProfileCheck?(profileId: string): void;
  now?: () => number;
}

/** Decide whether a pane target is the only pane in its current tab. */
function isLastPane(detail: SessionDetailDto, target: CloseTargetDto): boolean {
  if (target.kind !== "pane") {
    return false;
  }
  const tab = detail.tabs.find((candidate) => candidate.id === target.tabId);
  return tab !== undefined && countPanes(tab.layout) === 1;
}

/** Coordinate all FE-007 commands while leaving backend-owned state in route snapshots. */
export function useWorkspaceMutations(options: UseWorkspaceMutationsOptions): WorkspaceMutations {
  const [pending, setPending] = useState<WorkspaceOperation | null>(null);
  const [failure, setFailure] = useState<SessionsFailure | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [isSessionClosing, setSessionClosing] = useState(false);
  const structuralBusy = useRef(false);
  const activeTabTarget = useRef<string | null>(null);
  const activePaneTarget = useRef<string | null>(null);
  const ratioQueues = useRef(new Map<string, Promise<void>>());
  const detailRef = useRef(options.detail);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  const revisionRef = useRef(options.detail.revision);
  detailRef.current = options.detail;

  useEffect(() => {
    if (revisionRef.current !== options.detail.revision) {
      revisionRef.current = options.detail.revision;
      setSessionClosing(false);
    }
  }, [options.detail.revision]);

  /** Publish one operation failure with recovery specific to stale runtime targets. */
  const handleFailure = useCallback(
    (rejection: unknown, retry: (() => Promise<void>) | null = null) => {
      const error = sessionsErrorOf(rejection);
      if (error?.code === "runtimeShuttingDown") {
        setPendingClose(null);
        setFailure(null);
        return;
      }
      if (error?.code === "closeInProgress") {
        setSessionClosing(true);
      }
      if (
        error?.code === "sessionNotFound" ||
        error?.code === "tabNotFound" ||
        error?.code === "paneNotFound" ||
        error?.code === "splitNotFound" ||
        error?.code === "noClosedTab"
      ) {
        setPendingClose(null);
        setFailure(null);
        options.onRefresh();
        return;
      }
      if (error?.code === "paneNotEmpty") {
        setFailure(null);
        options.onRefresh();
        return;
      }
      if (error?.code === "profileNotFound") {
        options.onCatalogRefresh?.();
      }
      if (error?.code === "profileUnavailable") {
        options.onProfileUnavailable?.(error.profileId);
        options.onProfileCheck?.(error.profileId);
      }
      if (error?.code === "paneLimitReached" || error?.code === "invalidMove") {
        options.onRefresh();
      }
      retryRef.current = retry;
      setFailure(classifySessionsFailure(rejection));
    },
    [options],
  );

  /** Run one structural operation unless another structural command is already pending. */
  const runStructural = useCallback(
    async <T>(operation: WorkspaceOperation, action: () => Promise<T>): Promise<T | null> => {
      if (structuralBusy.current || isSessionClosing) {
        return null;
      }
      structuralBusy.current = true;
      setPending(operation);
      setFailure(null);
      retryRef.current = null;
      try {
        return await action();
      } catch (rejection: unknown) {
        handleFailure(rejection, async () => {
          await runStructural(operation, action);
        });
        return null;
      } finally {
        structuralBusy.current = false;
        setPending(null);
      }
    },
    [handleFailure, isSessionClosing],
  );

  const createTabAction = useCallback(async () => {
    const result = await runStructural("createTab", () => createTab(detailRef.current.summary.id));
    if (result !== null) options.onApplyDetail(result);
  }, [options, runStructural]);

  const renameTabAction = useCallback(
    async (tabId: string, name: string) => {
      const result = await runStructural("renameTab", () =>
        renameTab(detailRef.current.summary.id, tabId, name),
      );
      if (result !== null) {
        options.onApplyDetail(result);
        return true;
      }
      return false;
    },
    [options, runStructural],
  );

  const moveTabAction = useCallback(
    async (tabId: string, toIndex: number) => {
      const ids = detailRef.current.tabs.map((tab) => tab.id);
      const fromIndex = ids.indexOf(tabId);
      const bounded = Math.max(0, Math.min(toIndex, ids.length - 1));
      if (fromIndex < 0 || fromIndex === bounded) return;
      const beforeTabId = resolveMoveBeforeTabId(ids, tabId, bounded);
      const result = await runStructural("moveTab", () =>
        moveTab(detailRef.current.summary.id, tabId, beforeTabId),
      );
      if (result !== null) options.onApplyDetail(result);
    },
    [options, runStructural],
  );

  const activateTab = useCallback(
    async (tabId: string) => {
      if (
        detailRef.current.activeTabId === tabId ||
        activeTabTarget.current === tabId ||
        isSessionClosing
      )
        return;
      activeTabTarget.current = tabId;
      try {
        options.onApplyDetail(await setActiveTab(detailRef.current.summary.id, tabId));
        setFailure(null);
      } catch (rejection: unknown) {
        handleFailure(rejection);
      } finally {
        if (activeTabTarget.current === tabId) activeTabTarget.current = null;
      }
    },
    [handleFailure, isSessionClosing, options],
  );

  const activatePane = useCallback(
    async (tabId: string, paneId: string) => {
      const tab = detailRef.current.tabs.find((candidate) => candidate.id === tabId);
      const target = `${tabId}:${paneId}`;
      if (tab?.activePaneId === paneId || activePaneTarget.current === target || isSessionClosing)
        return;
      activePaneTarget.current = target;
      try {
        options.onApplyDetail(await setActivePane(detailRef.current.summary.id, tabId, paneId));
        setFailure(null);
      } catch (rejection: unknown) {
        handleFailure(rejection);
      } finally {
        if (activePaneTarget.current === target) activePaneTarget.current = null;
      }
    },
    [handleFailure, isSessionClosing, options],
  );

  const splitPaneAction = useCallback(
    async (tabId: string, paneId: string, direction: SplitDirectionDto) => {
      const tab = detailRef.current.tabs.find((candidate) => candidate.id === tabId);
      if (tab !== undefined && countPanes(tab.layout) >= PANE_LIMIT) {
        setFailure({
          kind: "busy",
          code: "paneLimitReached",
          message: PANE_LIMIT_MESSAGE,
          canRetry: false,
        });
        return;
      }
      const result = await runStructural("splitPane", () =>
        splitPane(detailRef.current.summary.id, tabId, paneId, direction),
      );
      if (result !== null) options.onApplyDetail(result);
    },
    [options, runStructural],
  );

  const commitSplitRatio = useCallback(
    async (tabId: string, splitId: string, ratioBasisPoints: number) => {
      if (isSessionClosing) return;
      const previous = ratioQueues.current.get(splitId) ?? Promise.resolve();
      const queued = previous.then(async () => {
        try {
          const result = await setSplitRatio(
            detailRef.current.summary.id,
            tabId,
            splitId,
            clampRatioBasisPoints(ratioBasisPoints),
          );
          options.onApplyDetail(result);
          setFailure(null);
        } catch (rejection: unknown) {
          handleFailure(rejection);
        }
      });
      ratioQueues.current.set(splitId, queued);
      await queued;
      if (ratioQueues.current.get(splitId) === queued) ratioQueues.current.delete(splitId);
    },
    [handleFailure, isSessionClosing, options],
  );

  const toggleMaximizedPane = useCallback(
    async (tabId: string, paneId: string) => {
      const tab = detailRef.current.tabs.find((candidate) => candidate.id === tabId);
      const nextPaneId = tab?.maximizedPaneId === paneId ? null : paneId;
      const result = await runStructural("maximizePane", () =>
        setMaximizedPane(detailRef.current.summary.id, tabId, nextPaneId),
      );
      if (result !== null) options.onApplyDetail(result);
    },
    [options, runStructural],
  );

  const selectPaneToolAction = useCallback(
    async (tabId: string, paneId: string, profileId: string) => {
      const result = await runStructural("selectPaneTool", () =>
        selectPaneTool(detailRef.current.summary.id, tabId, paneId, profileId),
      );
      if (result !== null) {
        recordToolUse(profileId, (options.now ?? Date.now)());
        options.onApplyDetail(result);
      }
    },
    [options, runStructural],
  );

  const reopenAction = useCallback(async () => {
    if (!detailRef.current.canReopenLastClosedTab) return;
    const result = await runStructural("reopenTab", () =>
      reopenLastClosedTab(detailRef.current.summary.id),
    );
    if (result !== null) options.onApplyDetail(result);
  }, [options, runStructural]);

  const finishClose = useCallback(
    async (target: CloseTargetDto, confirmed: boolean) => {
      try {
        const result = await closeRuntimeTarget(target, confirmed);
        setPendingClose(null);
        setFailure(null);
        if (result.session !== null) options.onApplyDetail(result.session);
        else options.onRefresh();
      } catch (rejection: unknown) {
        const error = sessionsErrorOf(rejection);
        if (error?.code === "confirmationRequired") {
          setPendingClose({
            target,
            impact: error.impact,
            isLastPaneOfTab: isLastPane(detailRef.current, target),
          });
          setFailure(null);
          return;
        }
        handleFailure(rejection, async () => finishClose(target, confirmed));
      }
    },
    [handleFailure, options],
  );

  const requestClose = useCallback(
    async (target: CloseTargetDto) => {
      if (structuralBusy.current || isSessionClosing) return;
      structuralBusy.current = true;
      setPending("inspectClose");
      setFailure(null);
      try {
        const impact = await getCloseImpact(target);
        if (impact.requiresConfirmation) {
          setPendingClose({
            target,
            impact,
            isLastPaneOfTab: isLastPane(detailRef.current, target),
          });
          return;
        }
        setPending("close");
        await finishClose(target, false);
      } catch (rejection: unknown) {
        const error = sessionsErrorOf(rejection);
        if (error?.code === "contentLifecycleFailed") {
          // There are no trustworthy facts after a failed inspection. The dialog remains the
          // only safe place to retry instead of accidentally bypassing a future confirmation.
          setPendingClose({
            target,
            impact: {
              target,
              requiresConfirmation: true,
              runningProcessCount: 0,
              runningProcessLabels: [],
              unsavedFileCount: 0,
              unsavedFileLabels: [],
            },
            isLastPaneOfTab: isLastPane(detailRef.current, target),
          });
        }
        handleFailure(rejection, async () => requestClose(target));
      } finally {
        structuralBusy.current = false;
        setPending(null);
      }
    },
    [finishClose, handleFailure, isSessionClosing],
  );

  const confirmClose = useCallback(async () => {
    const current = pendingClose;
    if (current === null || structuralBusy.current) return;
    structuralBusy.current = true;
    setPending("close");
    try {
      await finishClose(current.target, true);
    } finally {
      structuralBusy.current = false;
      setPending(null);
    }
  }, [finishClose, pendingClose]);

  const cancelClose = useCallback(() => {
    setPendingClose(null);
    setFailure(null);
  }, []);

  const clearFailure = useCallback(() => setFailure(null), []);

  const retryFailure = useCallback(async () => {
    const retry = retryRef.current;
    setFailure(null);
    if (retry !== null) await retry();
  }, []);

  return {
    pending,
    failure,
    isSessionClosing,
    pendingClose,
    createTab: createTabAction,
    renameTab: renameTabAction,
    moveTab: moveTabAction,
    activateTab,
    activatePane,
    splitPane: splitPaneAction,
    commitSplitRatio,
    toggleMaximizedPane,
    selectPaneTool: selectPaneToolAction,
    reopenLastClosedTab: reopenAction,
    requestClose,
    confirmClose,
    cancelClose,
    clearFailure,
    retryFailure,
  };
}
