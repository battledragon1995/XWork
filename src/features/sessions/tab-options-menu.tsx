import { MoreHorizontal } from "lucide-react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Render active-tab operations plus the two route-owned session intents. */
export function TabOptionsMenu(props: {
  triggerRef?: Ref<HTMLButtonElement>;
  isBusy: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canReopen: boolean;
  onRenameTab(): void;
  onMoveLeft(): void;
  onMoveRight(): void;
  onCloseTab(): void;
  onReopen(): void;
  onRenameSession(): void;
  onDeleteSession(): void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={props.triggerRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Tab options"
              disabled={props.isBusy}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Tab options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={props.onRenameTab}>Rename tab…</DropdownMenuItem>
          <DropdownMenuItem disabled={!props.canMoveLeft} onSelect={props.onMoveLeft}>
            Move tab left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.canMoveRight} onSelect={props.onMoveRight}>
            Move tab right
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={props.onCloseTab}>
            Close tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.canReopen} onSelect={props.onReopen}>
            Reopen closed tab
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={props.onRenameSession}>Rename session…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={props.onDeleteSession}>
            Delete Session
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
