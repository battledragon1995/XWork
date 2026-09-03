import { Folder, Pin, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useRef } from "react";
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

/**
 * The `Projects` block of the expanded sidebar. It reads the same unfiltered snapshot the page
 * reads, so the two surfaces can never disagree, and it shares the page's Add Project lock so
 * pressing both entry points opens exactly one native picker.
 *
 * The collapsed sidebar drops this whole block; that boundary stays in `AppShell`'s sidebar,
 * which is what FE-001 already owns.
 */
export function SidebarProjectList() {
  const { status, projects, failure, refresh } = useProjects();
  const add = useAddProject();
  const addButtonRef = useRef<HTMLButtonElement>(null);

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
              <ProjectRow key={project.id} project={project} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// Render one project row. Rows navigate only; no session children exist in this slice.
function ProjectRow(props: { project: ProjectDto }) {
  const { project } = props;
  const isUnavailable = project.availability.status === "unavailable";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className={cn(ROW_CLASS, isUnavailable && "text-muted")}>
        <NavLink to={`/projects/${project.id}`} end>
          <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
          <span>{project.displayName}</span>
        </NavLink>
      </SidebarMenuButton>

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
    </SidebarMenuItem>
  );
}
