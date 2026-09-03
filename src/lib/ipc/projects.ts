import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectFolderSelectionDto,
  ProjectGitStatusDto,
  ProjectsError,
  RemoveProjectImpactDto,
  RemoveProjectResultDto,
} from "@/bindings/projects/projects";
import { invokeCommand } from "./ipc-error";

/** Re-exported so feature hooks can type a subscription without importing Tauri directly. */
export type { UnlistenFn };

/** Event the backend emits after every committed project mutation. */
const PROJECTS_CHANGED_EVENT = "projects://changed";

// Call one Projects command with the shared error normalization of this layer.
function invokeProjects<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, ProjectsError>(command, args);
}

/**
 * List the registered projects with their freshly measured availability. `search` is omitted
 * entirely when the caller has none, so the backend applies its own unfiltered default rather
 * than receiving an empty filter.
 */
export function listProjects(search?: string): Promise<ProjectDto[]> {
  return invokeProjects<ProjectDto[]>(
    "list_projects",
    search === undefined ? undefined : { search },
  );
}

// Record that one project was opened and return its latest metadata snapshot.
export function openProject(projectId: string): Promise<ProjectDto> {
  return invokeProjects<ProjectDto>("open_project", { projectId });
}

// Read one project's latest metadata without advancing its last-opened timestamp.
export function getProject(projectId: string): Promise<ProjectDto> {
  return invokeProjects<ProjectDto>("get_project", { projectId });
}

// Read the current repository summary and visible worktree changes for one project.
export function getProjectGitStatus(projectId: string): Promise<ProjectGitStatusDto> {
  return invokeProjects<ProjectGitStatusDto>("get_project_git_status", { projectId });
}

// Open the native folder picker and register the chosen folder. Cancellation is a result,
// not an error, so callers branch on `outcome` instead of catching.
export function addProject(): Promise<ProjectFolderSelectionDto> {
  return invokeProjects<ProjectFolderSelectionDto>("add_project");
}

// Change the name XWork shows for one project. The folder on disk keeps its own name.
export function renameProject(projectId: string, displayName: string): Promise<ProjectDto> {
  return invokeProjects<ProjectDto>("rename_project", { projectId, displayName });
}

// Pin or unpin one project. The backend owns the resulting order, so callers re-read the list
// instead of moving the row themselves.
export function setProjectPinned(projectId: string, isPinned: boolean): Promise<ProjectDto> {
  return invokeProjects<ProjectDto>("set_project_pinned", { projectId, isPinned });
}

// Ask the operating system to reveal the registered root. Nothing about the project changes.
export function openProjectFolder(projectId: string): Promise<void> {
  return invokeProjects<void>("open_project_folder", { projectId });
}

// Open the native picker to point one project at a new root. Cancellation is a result, not
// an error, exactly as it is for `addProject`.
export function locateProjectFolder(projectId: string): Promise<ProjectFolderSelectionDto> {
  return invokeProjects<ProjectFolderSelectionDto>("locate_project_folder", { projectId });
}

// Read the facts a remove confirmation must state. The frontend never synthesizes them.
export function getRemoveProjectImpact(projectId: string): Promise<RemoveProjectImpactDto> {
  return invokeProjects<RemoveProjectImpactDto>("get_remove_project_impact", { projectId });
}

// Forget one project's metadata. `confirmed` is forwarded as given; the feature always sends
// `true` because the backend refuses an unconfirmed removal by design.
export function removeProject(
  projectId: string,
  confirmed: boolean,
): Promise<RemoveProjectResultDto> {
  return invokeProjects<RemoveProjectResultDto>("remove_project", { projectId, confirmed });
}

// Subscribe to project invalidation. The returned callback removes the listener.
export function onProjectsChanged(
  handler: (event: ProjectChangedEventDto) => void,
): Promise<UnlistenFn> {
  return listen<ProjectChangedEventDto>(
    PROJECTS_CHANGED_EVENT,
    (event: Event<ProjectChangedEventDto>) => {
      handler(event.payload);
    },
  );
}
