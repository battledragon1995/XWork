import { Power } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useShellStore } from "./shell-store";

// Render the wordmark and the menu it opens. The menu only presents the Quit entry point;
// the lifecycle state behind it is owned by the caller, never by this component.
export function AppMenu(props: { onQuit: () => void; isCheckingQuit: boolean }) {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="XWork menu"
        className="flex h-8 items-center rounded-sm px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          data-testid="wordmark"
          className="font-display text-[21px] leading-none tracking-tight text-ink"
        >
          <b className="font-medium text-brand">X</b>
          {!isCollapsed && <span>Work</span>}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2}>
        {/* §18 requires the destructive entry to sit last, behind a separator. The separator
            already reserves that boundary while later slices still have no entries above it. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={props.isCheckingQuit}
          onSelect={props.onQuit}
        >
          <Power aria-hidden="true" />
          {props.isCheckingQuit ? "Checking running work…" : "Quit XWork"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
