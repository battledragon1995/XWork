import { ProjectNotesSection } from "@/features/notes";
import { ProjectOverviewRoute } from "@/features/projects/project-overview-route";
/** Compose Notes only for the project identity validated by the overview owner. */
export function ProjectOverviewEntry() {
  return (
    <ProjectOverviewRoute
      renderLinkedNotes={
        /** Inject the public Notes projection at app level. */ (projectId) => (
          <ProjectNotesSection projectId={projectId} />
        )
      }
    />
  );
}
