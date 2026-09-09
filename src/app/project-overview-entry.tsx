import { ProjectCalendarSection } from "@/features/calendar";
import { useCalendarBoundary } from "./calendar-entry";
import { ProjectNotesSection } from "@/features/notes";
import { ProjectOverviewRoute } from "@/features/projects/project-overview-route";
/** Compose Notes only for the project identity validated by the overview owner. */
export function ProjectOverviewEntry() {
  const calendar = useCalendarBoundary();
  return (
    <ProjectOverviewRoute
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
