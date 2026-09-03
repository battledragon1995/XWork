import { Ellipsis, FolderOpen, FolderSearch, Pen, Pin, PinOff, Trash2 } from "lucide-react";
import type { Ref } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The intents one card's menu can raise. It runs no command of its own. */
export interface ProjectActionsMenuProps {
  project: ProjectDto;
  isBusy: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onRename(): void;
  onTogglePinned(): void;
  onOpenFolder(): void;
  onLocateFolder(): void;
  onRemove(): void;
}

/**
 * Render the five card actions in the documented order, with removal set apart below a
 * separator. The menu only reports intent: the route owns every command, so the same menu can
 * be driven from the project overview later without changing behavior.
 */
export function ProjectActionsMenu(props: ProjectActionsMenuProps) {
  const { project, isBusy, triggerRef } = props;
  const isUnavailable = project.availability.status === "unavailable";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              disabled={isBusy}
              className="text-muted"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More actions</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={props.onRename}>
          <Pen aria-hidden="true" />
          Rename project…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onTogglePinned}>
          {project.isPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          {project.isPinned ? "Unpin project" : "Pin project"}
        </DropdownMenuItem>
        <DropdownMenuItem
          // There is nothing to reveal while the root is unusable, so the item stays present
          // but inert rather than disappearing and shifting the rest of the menu.
          disabled={isUnavailable}
          onSelect={props.onOpenFolder}
        >
          <FolderOpen aria-hidden="true" />
          Open folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onLocateFolder}>
          <FolderSearch aria-hidden="true" />
          Locate folder…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={props.onRemove}>
          <Trash2 aria-hidden="true" />
          Remove Project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
