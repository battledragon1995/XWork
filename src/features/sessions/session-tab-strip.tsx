import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  SortableContext,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SessionDetailDto, TabDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionTab } from "./session-tab";
import { TabOptionsMenu } from "./tab-options-menu";

/** Render the non-wrapping tablist, sorting controls, and active-tab menu. */
export function SessionTabStrip(props: {
  detail: SessionDetailDto;
  activeTab: TabDto;
  isBusy: boolean;
  optionsTriggerRef?: React.Ref<HTMLButtonElement>;
  onCreate(): void;
  onSelect(tabId: string): void;
  onMove(tabId: string, toIndex: number): void;
  onClose(tabId: string): void;
  onRename(tab: TabDto): void;
  onReopen(): void;
  onRenameSession(): void;
  onDeleteSession(): void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const stripRef = useRef<HTMLDivElement>(null);
  const activeIndex = props.detail.tabs.findIndex((tab) => tab.id === props.activeTab.id);

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  /** Commit a drop only when dnd-kit reports a different valid destination. */
  const handleDragEnd = (event: DragEndEvent): void => {
    if (event.over === null || event.active.id === event.over.id) return;
    const toIndex = props.detail.tabs.findIndex((tab) => tab.id === event.over?.id);
    if (toIndex >= 0) props.onMove(String(event.active.id), toIndex);
  };

  /** Move focus within the tablist without changing backend selection. */
  const navigateTabs = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next = index;
    if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") next = Math.min(props.detail.tabs.length - 1, index + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = props.detail.tabs.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onSelect(props.detail.tabs[index]?.id ?? props.activeTab.id);
      return;
    } else return;
    event.preventDefault();
    stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div className="flex h-9.5 shrink-0 items-center border-b border-hairline px-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Session tabs"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap"
        >
          <SortableContext
            items={props.detail.tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {props.detail.tabs.map((tab, index) => (
              <SessionTab
                key={tab.id}
                tab={tab}
                isSelected={tab.id === props.activeTab.id}
                isBusy={props.isBusy}
                onSelect={() => props.onSelect(tab.id)}
                onClose={() => props.onClose(tab.id)}
                onRename={() => props.onRename(tab)}
                onNavigate={(event) => navigateTabs(event, index)}
              />
            ))}
          </SortableContext>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="New tab"
                disabled={props.isBusy}
                onClick={props.onCreate}
              >
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New tab (Ctrl T)</TooltipContent>
          </Tooltip>
        </div>
      </DndContext>
      <TabOptionsMenu
        triggerRef={props.optionsTriggerRef}
        isBusy={props.isBusy}
        canMoveLeft={activeIndex > 0}
        canMoveRight={activeIndex >= 0 && activeIndex < props.detail.tabs.length - 1}
        canReopen={props.detail.canReopenLastClosedTab}
        onRenameTab={() => props.onRename(props.activeTab)}
        onMoveLeft={() => props.onMove(props.activeTab.id, activeIndex - 1)}
        onMoveRight={() => props.onMove(props.activeTab.id, activeIndex + 1)}
        onCloseTab={() => props.onClose(props.activeTab.id)}
        onReopen={props.onReopen}
        onRenameSession={props.onRenameSession}
        onDeleteSession={props.onDeleteSession}
      />
    </div>
  );
}
