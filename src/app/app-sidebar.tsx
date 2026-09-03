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
import type { Transition } from "motion/react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { useShellStore } from "./shell-store";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/** The four primary areas of the sidebar, in the order the wireframe shows them. */
const AREAS: ReadonlyArray<{ label: string; to: string; icon: LucideIcon; end: boolean }> = [
  { label: "Home", to: "/", icon: House, end: true },
  { label: "Projects", to: "/projects", icon: Folder, end: false },
  { label: "Notes", to: "/notes", icon: FileText, end: false },
  { label: "Calendar", to: "/calendar", icon: Calendar, end: false },
];

/**
 * Left offset that holds an entry icon still across a collapse. An entry loses its own `px-2.5`
 * for the `p-2` the icon rail gives it, so without this the icon would slide 2px inwards; the
 * offset is exactly that difference, which lands every glyph on the shared `18px` rail inset
 * the wordmark in `app-topbar.tsx` also sits on.
 *
 * The offset has to be a fixed length. Centring the entry inside its list instead, with
 * `items-center` or an auto margin, resolves against the width of the list, and that width is
 * still animating: an entry snaps to `2rem` the moment the sidebar collapses, so it would land
 * in the middle of the still-open sidebar and only then ride the closing column back to the
 * left, which reads as the icons swinging right and returning.
 */
const COLLAPSED_ENTRY_OFFSET = "group-data-[collapsible=icon]:ml-0.5";

/** Shared shape of one sidebar entry, whether it navigates or acts on the shell. */
const ENTRY_CLASS = `h-8 gap-2.5 rounded-sm px-2.5 text-[13px] font-medium whitespace-nowrap text-body focus-visible:ring-ring ${COLLAPSED_ENTRY_OFFSET}`;

/**
 * Keep the moving highlight attached to the entry's live width while the sidebar changes width.
 * Position changes still use the spring, so moving between entries keeps its existing feel.
 */
const SIDEBAR_HIGHLIGHT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 350,
  damping: 35,
  width: { duration: 0 },
};

/** Nav item styling for the open area, taken from `#shell` rather than the component default. */
const ACTIVE_ENTRY_CLASS =
  "aria-[current=page]:bg-cream-strong aria-[current=page]:text-ink aria-[current=page]:[&>svg]:text-ink";

// Render the primary navigation, the empty Projects block and the sidebar footer. The sidebar
// itself is the single `navigation` landmark of the shell.
export function AppSidebar() {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const isResizing = useShellStore((state) => state.isSidebarResizing);
  const toggleCollapsed = useShellStore((state) => state.toggleSidebarCollapsed);
  const prefersReducedMotion = usePrefersReducedMotion();
  const collapseLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const CollapseIcon = isCollapsed ? ChevronsRight : ChevronsLeft;

  return (
    // The copied sidebar renders its container as a div, so the landmark is declared here
    // instead: the role has to travel with the element that actually wraps the entries.
    <Sidebar
      role="navigation"
      aria-label="Main"
      collapsible="icon"
      isResizing={isResizing}
      // Turning the effect off renders no animated element at all; the entries keep a static
      // hover background, so nothing about reaching or reading them changes.
      animateOnHover={!prefersReducedMotion}
      transition={SIDEBAR_HIGHLIGHT_TRANSITION}
      className="absolute h-full border-sidebar-border"
    >
      <SidebarContent className="gap-0">
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {AREAS.map((area) => (
                <AreaNavItem key={area.to} {...area} isCollapsed={isCollapsed} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* The project list itself belongs to FE-004 and BE-003, so only the empty state
            exists here. Icon mode drops the whole block, exactly as `#shell-collapsed` shows. */}
        {!isCollapsed && (
          <SidebarGroup className="pt-4">
            <SidebarGroupLabel className="mx-0.5 h-auto px-2 pb-1.5 text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
              Projects
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <p className="mx-0.5 px-2 text-xs leading-relaxed text-muted-soft">
                No projects yet. Add a folder to start a session.
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-0.5">
          <AreaNavItem
            label="Settings"
            to="/settings"
            icon={SlidersHorizontal}
            end={false}
            isCollapsed={isCollapsed}
          />
          <SidebarMenuItem>
            <SidebarIconAction label={collapseLabel} onClick={toggleCollapsed}>
              <CollapseIcon aria-hidden="true" className="size-4 text-muted-soft" />
            </SidebarIconAction>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

// Render one area entry. Its label stays in the DOM in icon mode, where the sidebar clips it
// and the same text is offered as a tooltip anchored on the link itself.
function AreaNavItem(props: {
  label: string;
  to: string;
  icon: LucideIcon;
  end: boolean;
  isCollapsed: boolean;
}) {
  const Icon = props.icon;
  const entry = (
    <SidebarMenuButton asChild className={cn(ENTRY_CLASS, ACTIVE_ENTRY_CLASS)}>
      <NavLink to={props.to} end={props.end}>
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span>{props.label}</span>
      </NavLink>
    </SidebarMenuButton>
  );

  return (
    <SidebarMenuItem>
      {props.isCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{entry}</TooltipTrigger>
          <TooltipContent side="right">{props.label}</TooltipContent>
        </Tooltip>
      ) : (
        entry
      )}
    </SidebarMenuItem>
  );
}

// Render the icon-only footer action and keep its label reachable in both sidebar widths.
function SidebarIconAction(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuButton
          type="button"
          aria-label={props.label}
          onClick={props.onClick}
          className={cn(ENTRY_CLASS, "font-normal text-muted-soft")}
        >
          {props.children}
          <span>{props.label}</span>
        </SidebarMenuButton>
      </TooltipTrigger>
      <TooltipContent side="right">{props.label}</TooltipContent>
    </Tooltip>
  );
}
