import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectFolderSelectionDto,
  ProjectsError,
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

// Open the native folder picker and register the chosen folder. Cancellation is a result,
// not an error, so callers branch on `outcome` instead of catching.
export function addProject(): Promise<ProjectFolderSelectionDto> {
  return invokeProjects<ProjectFolderSelectionDto>("add_project");
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
