import { ChevronDown, Folder, Pin, Plus, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { NavLink } from "react-router";
import type { ProjectDto } from "@/bindings/projects/projects";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { useAddProject } from "./use-add-project";
import { useProjects } from "./use-projects";

/** Row styling shared with the FE-001 area entries, so both lists read as one sidebar. */
const ROW_CLASS =
  "h-7 gap-2 rounded-sm px-2 text-[13px] whitespace-nowrap text-body focus-visible:ring-ring aria-[current=page]:bg-cream-strong aria-[current=page]:text-ink";

/** What the composition root may hand this block, and nothing more. */
export interface SidebarProjectListProps {
  /**
   * Project whose row must stay open, taken from the current route. It covers both
   * `/projects/:projectId` and `/sessions/:sessionId`, so an open session can never end up
   * hidden inside a collapsed row.
   */
  activeProjectId?: string | null;
  /**
   * Child rows of one project row. The slot receives only the public `ProjectDto` and is
   * rendered while that row is expanded, which is how the sessions feature composes its rows
   * here without either feature importing the other.
   */
  renderSessionRows?: (project: ProjectDto) => ReactNode;
}

/**
 * The `Projects` block of the expanded sidebar. It reads the same unfiltered snapshot the page
 * reads, so the two surfaces can never disagree, and it shares the page's Add Project lock so
 * pressing both entry points opens exactly one native picker.
 *
 * The collapsed sidebar drops this whole block; that boundary stays in `AppShell`'s sidebar,
 * which is what FE-001 already owns.
 */
export function SidebarProjectList(props: SidebarProjectListProps = {}) {
  const { activeProjectId = null, renderSessionRows } = props;
  const { status, projects, failure, refresh } = useProjects();
  const add = useAddProject();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * Rows the user opened by hand. It is deliberately process-local and additive: the active
   * project is forced open on top of it, so navigating never closes a row the user opened.
   */
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  /** Open or close one project row without touching any other row. */
  const toggleExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  /** Open one project row, used when the row itself is activated and navigates. */
  const expand = useCallback((projectId: string) => {
    setExpandedProjectIds((current) =>
      current.has(projectId) ? current : new Set(current).add(projectId),
    );
  }, []);

  // The native picker takes focus out of the webview, so a cancelled dialog would otherwise
  // leave focus on the document. Hand it back to the action that opened it.
  const restoreFocus = useCallback(() => {
    addButtonRef.current?.focus();
  }, []);

  const isFirstLoad = status === "loading" && projects.length === 0;

  return (
    <SidebarGroup className="pt-4">
      <SidebarGroupLabel className="mx-0.5 h-auto px-2 pb-1.5 text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
        Projects
      </SidebarGroupLabel>

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarGroupAction
            ref={addButtonRef}
            type="button"
            aria-label="Add Project"
            disabled={add.isAdding}
            className="top-4 size-[22px] text-muted-soft disabled:pointer-events-none disabled:opacity-60"
            onClick={() => void add.startAdd(restoreFocus)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </SidebarGroupAction>
        </TooltipTrigger>
        <TooltipContent side="right">Add Project</TooltipContent>
      </Tooltip>

      <SidebarGroupContent>
        {isFirstLoad ? (
          <div role="status" className="mx-0.5 px-2">
            <span className="sr-only">Loading your projects…</span>
          </div>
        ) : failure !== null ? (
          <div className="mx-0.5 px-2 text-xs leading-relaxed text-muted-soft">
            {/* No technical detail here on purpose: the page owns the full explanation. */}
            <p>Couldn&apos;t load projects.</p>
            <button
              type="button"
              className="rounded-xs font-medium text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={refresh}
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <p className="mx-0.5 px-2 text-xs leading-relaxed text-muted-soft">
            No projects yet. Add a folder to start a session.
          </p>
        ) : (
          <SidebarMenu className="gap-0.5">
            {projects.map((project) => (
              // Keyed by backend id, and rendered in the order the backend returned, so a pin
              // never reorders the page and the sidebar differently.
              <ProjectRow
                key={project.id}
                project={project}
                isExpanded={expandedProjectIds.has(project.id) || project.id === activeProjectId}
                onToggleExpanded={() => toggleExpanded(project.id)}
                onActivate={() => expand(project.id)}
                renderSessionRows={renderSessionRows}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// Render one project row, plus its expander and child rows when a slot is supplied.
function ProjectRow(props: {
  project: ProjectDto;
  isExpanded: boolean;
  onToggleExpanded(): void;
  onActivate(): void;
  renderSessionRows?: (project: ProjectDto) => ReactNode;
}) {
  const { project, isExpanded, renderSessionRows } = props;
  const isUnavailable = project.availability.status === "unavailable";

  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-center">
        {/* The expander exists only where child rows do, so the pre-FE-006 sidebar is
            unchanged for any composition that supplies no slot. */}
        {renderSessionRows !== undefined && (
          <button
            type="button"
            // The label stays stable and `aria-expanded` carries the state, so a screen
            // reader announces the change instead of the name changing under the user.
            aria-label={`Sessions for ${project.displayName}`}
            aria-expanded={isExpanded}
            className="flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={props.onToggleExpanded}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", !isExpanded && "-rotate-90")}
            />
          </button>
        )}
        <SidebarMenuButton
          asChild
          className={cn(ROW_CLASS, "min-w-0", isUnavailable && "text-muted")}
        >
          {/* Activating the name navigates and opens the row, per §7.5. The expander above
              deliberately does neither, so reading the sessions never moves the user. */}
          <NavLink to={`/projects/${project.id}`} end onClick={props.onActivate}>
            <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
            <span className="truncate" title={project.displayName}>
              {project.displayName}
            </span>
          </NavLink>
        </SidebarMenuButton>
      </div>

      {/* One badge per row. An unusable root outranks the pin marker, because it is the fact
          that changes what the user can do next. */}
      {isUnavailable ? (
        <SidebarMenuBadge className="top-1">
          <TriangleAlert aria-hidden="true" className="size-3.5 text-warn-ink" />
          <span className="sr-only">Folder unavailable</span>
        </SidebarMenuBadge>
      ) : project.isPinned ? (
        <SidebarMenuBadge className="top-1">
          <Pin aria-hidden="true" className="size-3 text-muted-soft" />
          <span className="sr-only">Pinned</span>
        </SidebarMenuBadge>
      ) : null}

      {isExpanded && renderSessionRows?.(project)}
    </SidebarMenuItem>
  );
}
