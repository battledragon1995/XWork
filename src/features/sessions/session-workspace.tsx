import { useEffect, useRef, useState } from "react";
import type { CloseTargetDto, SessionDetailDto, TabDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { CloseTargetDialog } from "./close-target-dialog";
import { PaneLayout } from "./pane-layout";
import { RenameTabDialog } from "./rename-tab-dialog";
import { SessionTabStrip } from "./session-tab-strip";
import { useToolCatalog } from "./use-tool-catalog";
import { useWorkspaceMutations } from "./use-workspace-mutations";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";
import type { SessionTerminalRenderer } from "./session-route";

/** Render the complete backend-owned tab and pane workspace for a nonempty session. */
export function SessionWorkspace(props: {
  detail: SessionDetailDto;
  rootPath: string | null;
  onApplyDetail(detail: SessionDetailDto): void;
  onRefresh(): void;
  onRenameSession(): void;
  onDeleteSession(): void;
  renderTerminal?: SessionTerminalRenderer;
}) {
  const catalog = useToolCatalog();
  const mutations = useWorkspaceMutations({
    detail: props.detail,
    onApplyDetail: props.onApplyDetail,
    onRefresh: props.onRefresh,
    onProfileUnavailable: catalog.markUnavailable,
    onCatalogRefresh: catalog.refresh,
    onProfileCheck: (profileId) => void catalog.check(profileId),
  });
  const [renameTarget, setRenameTarget] = useState<TabDto | null>(null);
  const refreshRequested = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const optionsTrigger = useRef<HTMLButtonElement | null>(null);
  const workspace = useRef<HTMLDivElement | null>(null);
  const activeTab =
    props.detail.tabs.find((tab) => tab.id === props.detail.activeTabId) ?? props.detail.tabs[0];
  const isBusy = mutations.pending !== null || mutations.isSessionClosing;

  useEffect(() => {
    if (
      props.detail.activeTabId !== null &&
      props.detail.tabs.some((tab) => tab.id === props.detail.activeTabId)
    ) {
      refreshRequested.current = false;
      return;
    }
    if (!refreshRequested.current) {
      refreshRequested.current = true;
      props.onRefresh();
    }
  }, [props]);

  /** Remember a durable opener before showing a workspace dialog. */
  const rememberDialogTrigger = (): void => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogTrigger.current =
      active?.getAttribute("role") === "menuitem" ? optionsTrigger.current : active;
  };

  /** Build a tab close target without weakening the generated union. */
  const closeTab = (tabId: string): void => {
    rememberDialogTrigger();
    const target: CloseTargetDto = { kind: "tab", sessionId: props.detail.summary.id, tabId };
    void mutations.requestClose(target);
  };

  /** Build a pane close target for the current active tab. */
  const closePane = (paneId: string): void => {
    if (activeTab === undefined) return;
    rememberDialogTrigger();
    const target: CloseTargetDto = {
      kind: "pane",
      sessionId: props.detail.summary.id,
      tabId: activeTab.id,
      paneId,
    };
    void mutations.requestClose(target);
  };

  /** Remember the focused opener before showing the rename dialog. */
  const openRename = (tab: TabDto): void => {
    rememberDialogTrigger();
    setRenameTarget(tab);
    mutations.clearFailure();
  };

  /** Restore focus to the opener or the surviving selected tab after a close. */
  const restoreFocus = (): void => {
    const trigger = dialogTrigger.current;
    dialogTrigger.current = null;
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }
    workspace.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };

  useWorkspaceShortcuts({
    isEnabled: !isBusy && renameTarget === null && mutations.pendingClose === null,
    canReopenTab: props.detail.canReopenLastClosedTab,
    onCreateTab: () => void mutations.createTab(),
    onCloseTab: () => {
      if (activeTab !== undefined) closeTab(activeTab.id);
    },
    onReopenTab: () => void mutations.reopenLastClosedTab(),
    onSplit: (direction) => {
      if (activeTab !== undefined)
        void mutations.splitPane(activeTab.id, activeTab.activePaneId, direction);
    },
    onToggleMaximize: () => {
      if (activeTab !== undefined)
        void mutations.toggleMaximizedPane(activeTab.id, activeTab.activePaneId);
    },
    onClosePane: () => {
      if (activeTab !== undefined) closePane(activeTab.activePaneId);
    },
  });

  if (activeTab === undefined) return null;

  return (
    <div ref={workspace} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <SessionTabStrip
        detail={props.detail}
        activeTab={activeTab}
        isBusy={isBusy}
        optionsTriggerRef={optionsTrigger}
        onCreate={() => void mutations.createTab()}
        onSelect={(tabId) => void mutations.activateTab(tabId)}
        onMove={(tabId, index) => void mutations.moveTab(tabId, index)}
        onClose={closeTab}
        onRename={openRename}
        onReopen={() => void mutations.reopenLastClosedTab()}
        onRenameSession={props.onRenameSession}
        onDeleteSession={props.onDeleteSession}
      />

      {mutations.failure !== null && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-1.5 text-[13px] text-error"
        >
          <span>{mutations.failure.message}</span>
          {mutations.failure.canRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void mutations.retryFailure()}
            >
              Try again
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <PaneLayout
          tab={activeTab}
          rootPath={props.rootPath}
          catalog={catalog}
          isBusy={isBusy}
          selectingProfileId={
            mutations.pending === "selectPaneTool" ? activeTab.activePaneId : null
          }
          ratioResetKey={`${props.detail.revision}:${mutations.failure?.code ?? "ready"}`}
          onActivatePane={(paneId) => void mutations.activatePane(activeTab.id, paneId)}
          onSplitPane={(paneId, direction) =>
            void mutations.splitPane(activeTab.id, paneId, direction)
          }
          onCommitRatio={(splitId, ratio) =>
            void mutations.commitSplitRatio(activeTab.id, splitId, ratio)
          }
          onToggleMaximize={(paneId) => void mutations.toggleMaximizedPane(activeTab.id, paneId)}
          onClosePane={closePane}
          onSelectProfile={(paneId, profile: CliProfileDto) =>
            void mutations.selectPaneTool(activeTab.id, paneId, profile.id)
          }
          sessionId={props.detail.summary.id}
          renderTerminal={props.renderTerminal}
          onRefreshSession={props.onRefresh}
          onCheckProfile={(profileId) => void catalog.check(profileId)}
        />
      </div>

      <RenameTabDialog
        tab={renameTarget}
        isPending={mutations.pending === "renameTab"}
        failure={renameTarget === null ? null : mutations.failure}
        onCancel={() => {
          setRenameTarget(null);
          mutations.clearFailure();
        }}
        onSubmit={(name) => {
          if (renameTarget === null) return;
          void mutations.renameTab(renameTarget.id, name).then((closed) => {
            if (closed) setRenameTarget(null);
          });
        }}
        onClosed={restoreFocus}
      />

      <CloseTargetDialog
        pendingClose={mutations.pendingClose}
        tabs={props.detail.tabs}
        isPending={mutations.pending === "close"}
        failure={mutations.pendingClose === null ? null : mutations.failure}
        onCancel={mutations.cancelClose}
        onConfirm={() => void mutations.confirmClose()}
        onRetry={() => void mutations.retryFailure()}
        onClosed={restoreFocus}
      />
    </div>
  );
}
