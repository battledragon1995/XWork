import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, useGroupRef } from "react-resizable-panels";
import type { PaneLayoutNodeDto, TabDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { PaneSplitHandle, ratioFromGroupLayout } from "./pane-split-handle";
import { countPanes, paneIndex, ratioToPercent } from "./session-layout";
import { SessionPane } from "./session-pane";
import type { ToolCatalogData } from "./use-tool-catalog";
import type { SessionTerminalRenderer } from "./session-route";

/** Callbacks shared by every recursive pane node. */
export interface PaneLayoutProps {
  sessionId?: string;
  tab: TabDto;
  rootPath: string | null;
  catalog: ToolCatalogData;
  isBusy: boolean;
  selectingProfileId: string | null;
  ratioResetKey?: string;
  onActivatePane(paneId: string): void;
  onSplitPane(paneId: string, direction: "right" | "down"): void;
  onCommitRatio(splitId: string, ratioBasisPoints: number): void;
  onToggleMaximize(paneId: string): void;
  onClosePane(paneId: string): void;
  onSelectProfile(paneId: string, profile: CliProfileDto): void;
  renderTerminal?: SessionTerminalRenderer;
  onRefreshSession?(): void;
  onCheckProfile?(profileId: string): void;
}

/** Render one split node and keep its temporary visual ratio local to that node. */
function SplitNode(
  props: PaneLayoutProps & { node: Extract<PaneLayoutNodeDto, { kind: "split" }> },
) {
  const { node } = props;
  const groupRef = useGroupRef();
  const firstPanelId = `${node.splitId}-first`;
  const secondPanelId = `${node.splitId}-second`;
  const [currentRatio, setCurrentRatio] = useState(node.ratioBasisPoints);
  const pointerRatio = useRef(node.ratioBasisPoints);
  const isInteracting = useRef(false);
  pointerRatio.current = currentRatio;
  const percent = ratioToPercent(node.ratioBasisPoints);
  const isMaximized = props.tab.maximizedPaneId !== null;

  useEffect(() => {
    const isRejectedCommit = props.ratioResetKey?.endsWith(":invalidSplitRatio") === true;
    if (isInteracting.current && !isRejectedCommit) return;
    setCurrentRatio(node.ratioBasisPoints);
    groupRef.current?.setLayout({
      [firstPanelId]: ratioToPercent(node.ratioBasisPoints),
      [secondPanelId]: 100 - ratioToPercent(node.ratioBasisPoints),
    });
  }, [firstPanelId, groupRef, node.ratioBasisPoints, props.ratioResetKey, secondPanelId]);

  const defaultLayout = useMemo(
    () => ({ [firstPanelId]: percent, [secondPanelId]: 100 - percent }),
    [firstPanelId, percent, secondPanelId],
  );

  return (
    <Group
      id={node.splitId}
      groupRef={groupRef}
      orientation={node.axis === "vertical" ? "horizontal" : "vertical"}
      defaultLayout={defaultLayout}
      className="h-full min-h-0 min-w-0"
      style={isMaximized ? { overflow: "visible" } : undefined}
      onLayoutChange={(layout) => setCurrentRatio(ratioFromGroupLayout(layout, firstPanelId))}
    >
      <Panel
        id={firstPanelId}
        defaultSize={`${percent}%`}
        minSize="10%"
        maxSize="90%"
        style={isMaximized ? { overflow: "visible" } : undefined}
      >
        <LayoutNode {...props} node={node.first} />
      </Panel>
      <PaneSplitHandle
        splitId={node.splitId}
        axis={node.axis}
        ratioBasisPoints={node.ratioBasisPoints}
        currentRatioBasisPoints={pointerRatio.current}
        firstPanelId={firstPanelId}
        secondPanelId={secondPanelId}
        groupRef={groupRef}
        disabled={isMaximized}
        onCommit={(ratio) => props.onCommitRatio(node.splitId, ratio)}
        onInteractionChange={(active) => {
          isInteracting.current = active;
        }}
      />
      <Panel
        id={secondPanelId}
        defaultSize={`${100 - percent}%`}
        minSize="10%"
        maxSize="90%"
        style={isMaximized ? { overflow: "visible" } : undefined}
      >
        <LayoutNode {...props} node={node.second} />
      </Panel>
    </Group>
  );
}

/** Recursively render one layout node in backend first-then-second order. */
function LayoutNode(props: PaneLayoutProps & { node: PaneLayoutNodeDto }) {
  const { node, tab } = props;
  if (node.kind === "split") return <SplitNode {...props} node={node} />;
  const profiles = props.catalog.snapshot?.profiles ?? [];
  return (
    <SessionPane
      pane={node.pane}
      tabId={tab.id}
      rootPath={props.rootPath}
      profiles={profiles}
      catalog={props.catalog}
      paneCount={countPanes(tab.layout)}
      paneIndex={paneIndex(tab.layout, node.pane.id)}
      isActive={tab.activePaneId === node.pane.id}
      isMaximized={tab.maximizedPaneId === node.pane.id}
      isHiddenByMaximize={tab.maximizedPaneId !== null && tab.maximizedPaneId !== node.pane.id}
      isBusy={props.isBusy}
      selectingProfileId={props.selectingProfileId}
      onActivate={() => props.onActivatePane(node.pane.id)}
      onSplit={(direction) => props.onSplitPane(node.pane.id, direction)}
      onToggleMaximize={() => props.onToggleMaximize(node.pane.id)}
      onClose={() => props.onClosePane(node.pane.id)}
      onSelectProfile={(profile) => props.onSelectProfile(node.pane.id, profile)}
      sessionId={props.sessionId}
      renderTerminal={props.renderTerminal}
      onRefreshSession={props.onRefreshSession}
      onCheckProfile={props.onCheckProfile}
    />
  );
}

/** Render one complete one-to-four-pane tab layout. */
export function PaneLayout(props: PaneLayoutProps) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden p-2">
      <LayoutNode {...props} node={props.tab.layout} />
    </div>
  );
}
