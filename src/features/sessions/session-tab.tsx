import { FileText, GripVertical, PanelTop, Terminal, X } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TabDto } from "@/bindings/sessions/sessions";
import { cn } from "@/lib/utils/cn";
import { findPane } from "./session-layout";

/** Render the icon for the active pane content represented by one tab. */
function TabContentIcon(props: { tab: TabDto }) {
  const content = findPane(props.tab.layout, props.tab.activePaneId)?.content;
  if (content?.kind === "file") return <FileText aria-hidden="true" className="size-3.5" />;
  if (content?.kind === "terminal" || content?.kind === "toolSelection")
    return <Terminal aria-hidden="true" className="size-3.5" />;
  return <PanelTop aria-hidden="true" className="size-3.5" />;
}

/** Render one accessible sortable tab and its independent close action. */
export function SessionTab(props: {
  tab: TabDto;
  isSelected: boolean;
  isBusy: boolean;
  onSelect(): void;
  onClose(): void;
  onRename(): void;
  onNavigate(event: React.KeyboardEvent<HTMLButtonElement>): void;
}) {
  const sortable = useSortable({ id: props.tab.id, disabled: props.isBusy });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group flex h-7 min-w-30 max-w-55 shrink-0 items-center rounded-sm motion-reduce:transition-none",
        props.isSelected ? "bg-surface-card text-ink" : "text-muted",
        sortable.isDragging && "opacity-55",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.isSelected}
        tabIndex={props.isSelected ? 0 : -1}
        title={props.tab.name}
        disabled={props.isBusy}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onSelect}
        onDoubleClick={props.onRename}
        onKeyDown={props.onNavigate}
      >
        <TabContentIcon tab={props.tab} />
        <span className="truncate font-medium">{props.tab.name}</span>
      </button>
      <button
        {...sortable.attributes}
        {...sortable.listeners}
        ref={sortable.setActivatorNodeRef}
        type="button"
        aria-label={`Reorder tab “${props.tab.name}”`}
        title={`Reorder tab “${props.tab.name}”`}
        disabled={props.isBusy}
        className="flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GripVertical aria-hidden="true" className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`Close tab “${props.tab.name}”`}
        title={`Close tab “${props.tab.name}”`}
        disabled={props.isBusy}
        className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onClose}
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  );
}
