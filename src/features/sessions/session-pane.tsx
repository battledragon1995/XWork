import {
  Columns2,
  FileText,
  Maximize2,
  Minimize2,
  PanelTop,
  Rows2,
  Terminal,
  X,
} from "lucide-react";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import type { PaneDto } from "@/bindings/sessions/sessions";
import type { CliProfileDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import type { ShortcutPlatform } from "@/lib/utils/keyboard-shortcuts";
import { PaneContentPicker } from "./pane-content-picker";
import { PaneContentPlaceholder } from "./pane-content-placeholder";
import { PANE_LIMIT } from "./session-layout";
import type { SessionTerminalRenderer } from "./session-route";
import type { ToolCatalogData } from "./use-tool-catalog";
import {
  shortcutLabel,
  type WorkspaceShortcutId,
  workspaceActionLabel,
} from "./workspace-shortcuts";

/** Resolve the visible pane title from backend content. */
function paneTitle(pane: PaneDto): string {
  return pane.content.kind === "empty" ? "New pane" : pane.content.title;
}

/** Render one pane leaf with its complete accessible action header. */
export function SessionPane(props: {
  shortcutSnapshot?: KeyboardShortcutsDto | null;
  shortcutPlatform?: ShortcutPlatform | null;

  pane: PaneDto;
  tabId: string;
  rootPath: string | null;
  profiles: readonly CliProfileDto[];
  catalog: ToolCatalogData;
  paneCount: number;
  paneIndex: number;
  isActive: boolean;
  isMaximized: boolean;
  isHiddenByMaximize: boolean;
  isBusy: boolean;
  selectingProfileId: string | null;
  onActivate(): void;
  onSplit(direction: "right" | "down"): void;
  onToggleMaximize(): void;
  onClose(): void;
  onSelectProfile(profile: CliProfileDto): void;
  sessionId?: string;
  renderTerminal?: SessionTerminalRenderer;
  onRefreshSession?(): void;
  onCheckProfile?(profileId: string): void;
}) {
  /** Resolve every pane accelerator from the dispatch snapshot. */
  const label = (text: string, id: WorkspaceShortcutId) =>
    workspaceActionLabel(text, id, props.shortcutSnapshot, props.shortcutPlatform);
  const restoreShortcut = shortcutLabel(
    "panes.maximizeToggle",
    props.shortcutSnapshot,
    props.shortcutPlatform,
  );
  const splitDisabled = props.paneCount >= PANE_LIMIT || props.isBusy;
  const splitTooltip =
    splitDisabled && props.paneCount >= PANE_LIMIT ? "A tab can hold up to 4 panes." : null;
  const profileId = "profileId" in props.pane.content ? props.pane.content.profileId : null;
  const profile = props.profiles.find((candidate) => candidate.id === profileId);

  /** Activate the pane before executing one of its header actions. */
  const act = (action: () => void): void => {
    props.onActivate();
    action();
  };

  /** Render one icon-only pane action with its complete tooltip. */
  const actionButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = props.isBusy,
    pressed?: boolean,
    tooltip = label,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={() => act(onClick)}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );

  return (
    <section
      data-pane-id={props.pane.id}
      tabIndex={props.isHiddenByMaximize ? -1 : 0}
      inert={props.isHiddenByMaximize ? true : undefined}
      aria-current={props.isActive ? "true" : undefined}
      aria-hidden={props.isHiddenByMaximize || undefined}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-dark outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.isActive ? "border-body" : "border-transparent",
        props.pane.content.kind === "empty" && "border-hairline bg-canvas",
        props.isMaximized && "absolute inset-0 z-20",
        props.isHiddenByMaximize && "invisible pointer-events-none",
      )}
      onFocus={() => props.onActivate()}
      onMouseDown={() => props.onActivate()}
    >
      <header
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 px-2 text-xs",
          props.pane.content.kind === "empty"
            ? "bg-surface-soft text-body"
            : "bg-dark-elevated text-on-dark",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-cream-strong text-[10px] text-ink"
          style={
            profile === undefined ? undefined : { backgroundColor: profile.color, color: "white" }
          }
        >
          {profile?.icon ??
            (props.pane.content.kind === "file" ? (
              <FileText className="size-3.5" />
            ) : props.pane.content.kind === "empty" ? (
              <PanelTop className="size-3.5" />
            ) : (
              <Terminal className="size-3.5" />
            ))}
        </span>
        <span className="min-w-0 shrink truncate font-medium" title={paneTitle(props.pane)}>
          {paneTitle(props.pane)}
        </span>
        {props.rootPath !== null && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-muted-soft"
            title={props.rootPath}
          >
            {props.rootPath}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          {actionButton(
            label("Split right", "panes.splitRight"),
            <Columns2 />,
            () => props.onSplit("right"),
            splitDisabled,
            undefined,
            splitTooltip ?? label("Split right", "panes.splitRight"),
          )}
          {actionButton(
            label("Split down", "panes.splitDown"),
            <Rows2 />,
            () => props.onSplit("down"),
            splitDisabled,
            undefined,
            splitTooltip ?? label("Split down", "panes.splitDown"),
          )}
          {actionButton(
            props.isMaximized
              ? label("Restore layout", "panes.maximizeToggle")
              : label("Maximize pane", "panes.maximizeToggle"),
            props.isMaximized ? <Minimize2 /> : <Maximize2 />,
            props.onToggleMaximize,
            props.isBusy,
            props.isMaximized,
          )}
          {actionButton(label("Close pane", "panes.close"), <X />, props.onClose)}
        </span>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {props.pane.content.kind === "empty" ? (
          <PaneContentPicker
            catalog={props.catalog}
            selectingProfileId={props.selectingProfileId}
            isLocked={props.isBusy}
            onSelect={props.onSelectProfile}
          />
        ) : (props.pane.content.kind === "toolSelection" ||
            props.pane.content.kind === "terminal") &&
          props.renderTerminal !== undefined ? (
          props.renderTerminal({
            sessionId: props.sessionId ?? "",
            tabId: props.tabId,
            paneId: props.pane.id,
            content: props.pane.content,
            isActive: props.isActive,
            isVisible: !props.isHiddenByMaximize,
            onActivate: props.onActivate,
            onRefreshSession: props.onRefreshSession ?? (() => undefined),
            onCheckProfile: props.onCheckProfile ?? (() => undefined),
          })
        ) : (
          <PaneContentPlaceholder content={props.pane.content} profiles={props.profiles} />
        )}
      </div>

      {props.isMaximized && (
        <div className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-dark-elevated px-3 py-1 text-xs text-on-dark shadow-pop">
          Maximized · {props.paneIndex} of {props.paneCount} panes
          {restoreShortcut &&
            ` · ${restoreShortcut}${restoreShortcut.startsWith("Shortcut conflict") ? "" : " to restore"}`}
        </div>
      )}
    </section>
  );
}
