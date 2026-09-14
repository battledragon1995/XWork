import { ProjectCalendarSection } from "@/features/calendar";
import { RecentProjectFiles } from "@/features/files";
import { ProjectNotesSection } from "@/features/notes";
import { ProjectOverviewRoute } from "@/features/projects/project-overview-route";
import { useCalendarBoundary } from "./calendar-entry";
/** Compose Notes only for the project identity validated by the overview owner. */
export function ProjectOverviewEntry() {
  const calendar = useCalendarBoundary();
  return (
    <ProjectOverviewRoute
      renderRecentFiles={
        /** Keep file queries scoped to the verified project and current app boundary. */ (
          projectId,
        ) => <RecentProjectFiles projectId={projectId} {...calendar} />
      }
      renderLinkedEvents={
        /** Inject Calendar only after the overview verifies the project identity. */ (
          projectId,
        ) => <ProjectCalendarSection projectId={projectId} {...calendar} />
      }
      renderLinkedNotes={
        /** Inject the public Notes projection at app level. */ (projectId) => (
          <ProjectNotesSection projectId={projectId} />
        )
      }
    />
  );
}
