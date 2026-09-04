import { Ellipsis, Pen, Trash2 } from "lucide-react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The two intents the session header's menu can raise. It runs no command of its own. */
export interface SessionActionsMenuProps {
  isBusy: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onRename(): void;
  onDelete(): void;
}

/**
 * Render the session header's two actions, with the destructive one set apart below a
 * separator. The menu reports intent only: the route owns every command, which is what lets
 * FE-007 move these two entries onto the tab strip without touching this component.
 */
export function SessionActionsMenu(props: SessionActionsMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={props.triggerRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              disabled={props.isBusy}
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
          Rename session…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
          <Trash2 aria-hidden="true" />
          Delete Session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
