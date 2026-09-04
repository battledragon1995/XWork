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
import { type ReactNode, useEffect } from "react";
import { NavLink, useMatches } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarProjectList } from "@/features/projects/sidebar-project-list";
import { readSessionProjectId, useSessionsStore } from "@/features/sessions/sessions-store";
import { SidebarSessionRows } from "@/features/sessions/sidebar-session-rows";
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

/**
 * Identify the project the current route belongs to, for both routes that have one.
 *
 * `/projects/:projectId` names it directly. `/sessions/:sessionId` does not, so it is
 * resolved through the retained session snapshot; the subscription is what makes the sidebar
 * recompute once that snapshot arrives.
 */
function useRouteProject(): { activeProjectId: string | null; isSessionRoute: boolean } {
  useSessionsStore((state) => state.sessionsByProject);
  const matches = useMatches();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const params = matches[index]?.params ?? {};

    if (typeof params.projectId === "string") {
      return { activeProjectId: params.projectId, isSessionRoute: false };
    }
    if (typeof params.sessionId === "string") {
      return {
        activeProjectId: readSessionProjectId(params.sessionId),
        isSessionRoute: true,
      };
    }
  }

  return { activeProjectId: null, isSessionRoute: false };
}

// Render the primary navigation, the Projects block and the sidebar footer. The sidebar itself
// is the single `navigation` landmark of the shell.
export function AppSidebar() {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const isResizing = useShellStore((state) => state.isSidebarResizing);
  const toggleCollapsed = useShellStore((state) => state.toggleSidebarCollapsed);
  const prefersReducedMotion = usePrefersReducedMotion();
  const collapseLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const CollapseIcon = isCollapsed ? ChevronsRight : ChevronsLeft;
  const { activeProjectId, isSessionRoute } = useRouteProject();

  /**
   * Keep the session snapshot loaded while anything in the shell reads it: the project rows
   * below, or the breadcrumb of a session route. Icon mode with no session open releases it
   * again, so a collapsed sidebar leaks neither a query nor a listener.
   */
  const needsSessions = !isCollapsed || isSessionRoute;
  useEffect(() => {
    if (!needsSessions) {
      return;
    }

    const { acquire, release } = useSessionsStore.getState();
    acquire();

    return release;
  }, [needsSessions]);

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

        {/* The project list and its Add Project action belong to FE-004, which owns the whole
            block. Icon mode drops it entirely, exactly as `#shell-collapsed` shows, and that
            boundary stays here rather than moving into the feature. */}
        {!isCollapsed && (
          <SidebarProjectList
            activeProjectId={activeProjectId}
            // The session rows belong to the sessions feature and are joined to the project
            // rows here, which is why neither feature imports the other.
            renderSessionRows={(project) => <SidebarSessionRows projectId={project.id} />}
          />
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
