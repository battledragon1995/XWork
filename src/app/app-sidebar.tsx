import {
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Folder,
  House,
  type LucideIcon,
  SlidersHorizontal,
} from "lucide-react";
import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { useShellStore } from "./shell-store";

/** The four primary areas of the sidebar, in the order the wireframe shows them. */
const AREAS: ReadonlyArray<{ label: string; to: string; icon: LucideIcon; end: boolean }> = [
  { label: "Home", to: "/", icon: House, end: true },
  { label: "Projects", to: "/projects", icon: Folder, end: false },
  { label: "Notes", to: "/notes", icon: FileText, end: false },
  { label: "Calendar", to: "/calendar", icon: Calendar, end: false },
];

// Render the primary navigation, the empty Projects block and the sidebar footer.
export function AppSidebar() {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const toggleCollapsed = useShellStore((state) => state.toggleSidebarCollapsed);
  const collapseLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const CollapseIcon = isCollapsed ? ChevronsRight : ChevronsLeft;

  return (
    <nav
      aria-label="Main"
      className="flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-hairline bg-surface-soft p-2"
    >
      {AREAS.map((area) => (
        <AreaNavLink key={area.to} {...area} isCollapsed={isCollapsed} />
      ))}

      {/* The project list itself belongs to FE-004 and BE-003, so only the empty state exists
          here. Icon mode hides the whole block, exactly as `#shell-collapsed` shows. */}
      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="mt-4 mr-2.5 mb-1.5 ml-2.5 text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
            Projects
          </p>
          <p className="mx-2.5 my-2 text-xs leading-relaxed text-muted-soft">
            No projects yet. Add a folder to start a session.
          </p>
        </div>
      )}

      <div className={cn("flex flex-col gap-0.5", isCollapsed ? "mt-auto" : "")}>
        <AreaNavLink
          label="Settings"
          to="/settings"
          icon={SlidersHorizontal}
          end={false}
          isCollapsed={isCollapsed}
        />
        <SidebarIconAction
          label={collapseLabel}
          isCollapsed={isCollapsed}
          onClick={toggleCollapsed}
        >
          <CollapseIcon aria-hidden="true" className="size-4 text-muted-soft" />
        </SidebarIconAction>
      </div>
    </nav>
  );
}

// Render one area entry. Its label stays in the accessibility tree in icon mode, where the
// same text is also offered as a tooltip.
function AreaNavLink(props: {
  label: string;
  to: string;
  icon: LucideIcon;
  end: boolean;
  isCollapsed: boolean;
}) {
  const Icon = props.icon;
  const link = (
    <NavLink
      to={props.to}
      end={props.end}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-sm text-[13px] font-medium whitespace-nowrap text-body outline-none",
        "aria-[current=page]:bg-cream-strong aria-[current=page]:text-ink",
        "focus-visible:ring-2 focus-visible:ring-ring",
        props.isCollapsed ? "justify-center px-0" : "px-2.5",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
      <span className={props.isCollapsed ? "sr-only" : undefined}>{props.label}</span>
    </NavLink>
  );

  if (!props.isCollapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  );
}

// Render the icon-only footer action and keep its label reachable in both sidebar widths.
function SidebarIconAction(props: {
  label: string;
  isCollapsed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      aria-label={props.label}
      onClick={props.onClick}
      className={cn(
        "h-8 w-full shrink-0 justify-start gap-2.5 rounded-sm text-[13px] font-normal text-muted-soft",
        props.isCollapsed ? "justify-center px-0" : "px-2.5",
      )}
    >
      {props.children}
      <span className={props.isCollapsed ? "sr-only" : undefined}>{props.label}</span>
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  );
}
