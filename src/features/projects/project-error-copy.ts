import type {
  InvalidProjectFolderReasonDto,
  ProjectsError,
  ProjectUnavailableReasonDto,
} from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Copy for a failure the user cannot retry, only restart out of. */
export const INTEGRATION_MESSAGE =
  "XWork ran into a problem it cannot recover from. Restart XWork.";

/** Copy for the one list failure that is worth another attempt. */
export const LOAD_FAILED_MESSAGE = "XWork couldn't load your projects.";

/** Copy for a retryable failure while opening an overview for the first time. */
export const OVERVIEW_OPEN_FAILED_MESSAGE = "XWork couldn't open this project.";

/** Copy for a retryable metadata refresh that keeps the previous overview visible. */
export const OVERVIEW_REFRESH_FAILED_MESSAGE = "XWork couldn't refresh this project.";

/** Copy shared by the two Add Project failures that happen after a folder was accepted. */
const ADD_SAVE_FAILED_MESSAGE = "XWork couldn't save the project. Try again.";

/** Copy shared by every action whose write could not be committed. */
const ACTION_SAVE_FAILED_MESSAGE = "XWork couldn't save that change. Try again.";

/** Copy shared by the three reasons that describe an unusable path rather than a bad folder. */
const UNUSABLE_PATH_MESSAGE = "XWork can't use that folder's path. Pick another folder.";

/** Copy shared by the picker failure of both Add Project and Locate folder. */
const PICKER_FAILED_MESSAGE = "XWork couldn't open the folder picker. Try again.";

/** One message per generated invalid-folder reason, so a new reason cannot go unhandled. */
const INVALID_FOLDER_MESSAGES: Record<InvalidProjectFolderReasonDto, string> = {
  missing: "That folder no longer exists. Pick another folder.",
  notDirectory: "That path is a file, not a folder. Pick a folder.",
  fileSystemRoot: "A drive root can't be a project. Pick a folder inside it.",
  accessDenied: "XWork can't read that folder. Check its permissions or pick another folder.",
  notAbsolute: UNUSABLE_PATH_MESSAGE,
  notUtf8: UNUSABLE_PATH_MESSAGE,
  cannotCanonicalize: UNUSABLE_PATH_MESSAGE,
};

/** One reason line per generated availability reason, shown on an unavailable card. */
const UNAVAILABLE_MESSAGES: Record<ProjectUnavailableReasonDto, string> = {
  missing: "Folder not found.",
  notDirectory: "That path is no longer a folder.",
  accessDenied: "XWork can't read that folder.",
  io: "XWork couldn't check that folder.",
};

/** One failed list or search query, plus the recovery it allows. */
export interface ProjectListFailure {
  kind: "retryable" | "integration";
  message: string;
}

/** One failed project metadata read and the route-level recovery it permits. */
export type ProjectReadFailure =
  | { kind: "retryable"; message: string }
  | { kind: "gone" }
  | { kind: "integration"; message: string };

/** One failed Git snapshot read and the route-level recovery it permits. */
export type ProjectGitFailure =
  | { kind: "retryable"; message: string }
  | { kind: "unavailable" }
  | { kind: "gone" }
  | { kind: "integration"; message: string };

/** One failed attempt to register a folder, plus the recovery it allows. */
export type AddProjectFailure =
  | { kind: "retryable"; message: string }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "integration"; message: string };

/** The six per-project commands, used both as a pending marker and as a retry target. */
export type ProjectOperation = "rename" | "pin" | "openFolder" | "locate" | "impact" | "remove";

/**
 * One failed project action. `retry` names the operation a `Try again` control should repeat,
 * and is `null` for a message the user can only read and wait out.
 */
export type ProjectActionFailure =
  | { kind: "retryable"; message: string; retry: ProjectOperation | null }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "gone"; message: string }
  | { kind: "integration"; message: string };

/**
 * Read the tagged Projects payload out of one rejection. Anything the adapter could not
 * recognize stays `null` and is treated as unrecoverable rather than guessed at.
 */
export function projectsErrorOf(rejection: unknown): ProjectsError | null {
  return rejection instanceof IpcCallError ? (rejection.payload as ProjectsError | null) : null;
}

/**
 * Sort one `list_projects` rejection into the two recovery paths the surfaces offer. Only a
 * persistence failure is worth another attempt; `unauthorizedWindow`, `invalidSearch` and
 * every payload this build cannot read are terminal, so no retry loop can form.
 */
export function classifyListFailure(rejection: unknown): ProjectListFailure {
  const error = projectsErrorOf(rejection);

  return error?.code === "persistenceFailed"
    ? { kind: "retryable", message: LOAD_FAILED_MESSAGE }
    : { kind: "integration", message: INTEGRATION_MESSAGE };
}

/** Build the retryable Git copy with the current display name. */
export function gitStatusFailedMessage(name: string): string {
  return `XWork couldn't read Git status for ${name}.`;
}

/** Classify an initial open or later metadata refresh without guessing unknown payloads. */
export function classifyProjectReadFailure(
  rejection: unknown,
  mode: "open" | "refresh",
): ProjectReadFailure {
  const error = projectsErrorOf(rejection);

  switch (error?.code) {
    case "projectNotFound":
    case "removalInProgress":
      return { kind: "gone" };
    case "persistenceFailed":
      return {
        kind: "retryable",
        message: mode === "open" ? OVERVIEW_OPEN_FAILED_MESSAGE : OVERVIEW_REFRESH_FAILED_MESSAGE,
      };
    case "clockFailed":
      return mode === "open"
        ? { kind: "retryable", message: OVERVIEW_OPEN_FAILED_MESSAGE }
        : { kind: "integration", message: INTEGRATION_MESSAGE };
    default:
      return { kind: "integration", message: INTEGRATION_MESSAGE };
  }
}

/** Classify a read-only Git rejection into retry, metadata refresh, navigation, or restart. */
export function classifyGitFailure(rejection: unknown, name: string): ProjectGitFailure {
  const error = projectsErrorOf(rejection);

  switch (error?.code) {
    case "gitInspectionFailed":
      return { kind: "retryable", message: gitStatusFailedMessage(name) };
    case "projectUnavailable":
      return { kind: "unavailable" };
    case "projectNotFound":
    case "removalInProgress":
      return { kind: "gone" };
    default:
      return { kind: "integration", message: INTEGRATION_MESSAGE };
  }
}

/**
 * Turn one `add_project` rejection into the message and recovery both entry points offer.
 * The table is identical to the one FE-002 uses on the Welcome screen on purpose: the same
 * failure must read the same way wherever the user started the flow.
 */
export function classifyAddFailure(rejection: unknown): AddProjectFailure {
  const error = projectsErrorOf(rejection);

  switch (error?.code) {
    case "folderPickerFailed":
      return { kind: "retryable", message: PICKER_FAILED_MESSAGE };
    case "invalidProjectFolder":
      return { kind: "retryable", message: INVALID_FOLDER_MESSAGES[error.reason] };
    case "invalidDisplayName":
      return {
        kind: "retryable",
        message: "XWork couldn't use that folder's name. Pick a different folder.",
      };
    case "projectAlreadyExists":
      // `project_id` is the generated snake_case field. Renaming it here would silently
      // navigate to `undefined` instead of the project that already owns the folder.
      return {
        kind: "duplicate",
        message: "That folder is already a project in XWork.",
        projectId: error.project_id,
      };
    case "clockFailed":
    case "persistenceFailed":
      return { kind: "retryable", message: ADD_SAVE_FAILED_MESSAGE };
    default:
      return { kind: "integration", message: INTEGRATION_MESSAGE };
  }
}

/**
 * Turn one rejection from a per-project command into the message, group and retry target
 * FE-004 assigns it. `name` is the display name of the target project, which several messages
 * quote, and `operation` is what a retry control would repeat.
 */
export function classifyActionFailure(
  rejection: unknown,
  context: { name: string; operation: ProjectOperation },
): ProjectActionFailure {
  const error = projectsErrorOf(rejection);
  const { name, operation } = context;

  switch (error?.code) {
    case "projectNotFound":
      // The project is gone, so every open menu and dialog for it is meaningless. There is
      // nothing to retry; the caller closes its surfaces and refreshes the list instead.
      return { kind: "gone", message: `${name} is no longer in XWork.` };
    case "invalidDisplayName":
      return {
        kind: "retryable",
        message: "Enter a name between 1 and 255 characters, without control characters.",
        retry: null,
      };
    case "removalInProgress":
      return {
        kind: "retryable",
        message: `${name} is being removed. Wait for that to finish.`,
        retry: null,
      };
    case "projectUnavailable":
      // Retrying the opener cannot succeed while the path is unusable, so the offered
      // recovery is relocation instead of another attempt at the same command.
      return {
        kind: "retryable",
        message: "XWork can't open that folder any more.",
        retry: "locate",
      };
    case "openFolderFailed":
      return {
        kind: "retryable",
        message: `XWork couldn't open the folder for ${name}. Try again.`,
        retry: "openFolder",
      };
    case "folderPickerFailed":
      return { kind: "retryable", message: PICKER_FAILED_MESSAGE, retry: "locate" };
    case "invalidProjectFolder":
      return {
        kind: "retryable",
        message: INVALID_FOLDER_MESSAGES[error.reason],
        retry: "locate",
      };
    case "projectAlreadyExists":
      return {
        kind: "duplicate",
        message: "That folder is already another project in XWork.",
        projectId: error.project_id,
      };
    case "runtimeInspectionFailed":
      return {
        kind: "retryable",
        message: `XWork couldn't check what is still running for ${name}.`,
        retry: operation,
      };
    case "runtimeCleanupFailed":
      return {
        kind: "retryable",
        message: `XWork couldn't stop everything for ${name}, so it was not removed.`,
        retry: "remove",
      };
    case "clockFailed":
    case "persistenceFailed":
      return { kind: "retryable", message: ACTION_SAVE_FAILED_MESSAGE, retry: operation };
    default:
      // `invalidProjectId` lands here too: an id only ever comes from a `ProjectDto`, so it
      // means the boundary is wrong rather than that the user typed something invalid.
      return { kind: "integration", message: INTEGRATION_MESSAGE };
  }
}

// Describe why a project root is unusable, in the wording the card's reason line uses.
export function unavailableReasonMessage(reason: ProjectUnavailableReasonDto): string {
  return UNAVAILABLE_MESSAGES[reason];
}
