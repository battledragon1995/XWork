import type {
  FileSearchTruncatedReasonDto,
  FilesError,
  FileTreeWarningReasonDto,
} from "@/bindings/files/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";

export const INVALID_FILTER = "Use 1–128 characters without control characters.";
export const VIEWING_LIMITATION =
  "File viewing is not available yet. You can copy paths or reveal files.";
const errors: Record<FilesError["code"], string> = {
  windowNotAllowed: "File Explorer is only available in the main window.",
  invalidProjectId: "Could not identify this project.",
  projectNotFound: "This project is no longer available.",
  projectUnavailable: "Project folder is unavailable.",
  projectRemovalInProgress: "File Explorer is temporarily unavailable.",
  projectAccessFailed: "Could not load this project.",
  projectRootChanged: "Project folder changed. Reloading files…",
  invalidRelativePath: "This entry cannot be accessed.",
  invalidSearch: INVALID_FILTER,
  invalidCursor: "Folder contents changed. Reloading…",
  entryNotFound: "This entry is no longer available.",
  entryNotVisible: "This entry is no longer available.",
  notDirectory: "This entry is no longer a folder.",
  notRegularFile: "This entry is not a regular file.",
  linkTraversalDenied: "Symbolic links cannot be expanded or revealed.",
  traversalLimitExceeded:
    "This folder is too large to list. Use Filter files or open the project folder.",
  fileSystemReadFailed: "Could not read this folder.",
  invalidSessionTarget: "This pane is no longer available.",
  paneNotEmpty: "This pane already contains something.",
  sessionAttachFailed: "Could not open the file in this pane.",
  invalidFileHandleId: "Could not identify this open file.",
  fileHandleNotFound: "This file is no longer open.",
  revisionConflict: "This file changed. Refresh and try again.",
  noExternalConflict: "This file no longer has an external conflict.",
  fileChangedAgain: "The file changed again. Review the latest version.",
  unsavedChangesWouldBeLost: "Resolve unsaved changes before reloading.",
  fileChangedDuringRead: "The file changed while it was being read. Try again.",
  fileReadFailed: "Could not read this file.",
  fileMemoryLimitReached: "Close another file and try again.",
  revealFailed: "Could not reveal this entry. Try again or copy its path.",
  invalidLimit: "Could not list the requested files.",
  recentFilesFailed: "Could not load recent files.",
  clockFailed: "Could not open the file. Check the system clock.",
  openExternalFailed: "Could not open this file with the default app.",
};
/** Read only a normalized public error code, never raw transport text. */
export function fileErrorCode(error: unknown): string | undefined {
  return error instanceof IpcCallError ? error.payload?.code : undefined;
}
/** Render safe copy even when an unknown backend or transport failure arrives. */
export function fileErrorCopy(error: unknown, search = false): string {
  const code = fileErrorCode(error);
  if (code === "unauthorizedWindow") return errors.windowNotAllowed;
  if (code === "removalInProgress") return errors.projectRemovalInProgress;
  if (search && code === "fileSystemReadFailed") return "Could not search files.";
  return errors[code as FilesError["code"]] ?? "Could not complete this file action. Try again.";
}
/** Explain backend warning reasons without interpreting ignore rules in the frontend. */
export function warningCopy(reason: FileTreeWarningReasonDto): string {
  return {
    unreadableEntry: "Some entries could not be read.",
    invalidIgnoreRule: "Some ignore rules are invalid.",
    unsupportedName: "Some names are not supported.",
  }[reason];
}
/** Explain the exact backend search limit without implying complete results. */
export function truncationCopy(reason: FileSearchTruncatedReasonDto): string {
  return {
    resultLimit: "Showing up to 200 matches. Narrow your filter.",
    scanLimit: "Search limit reached. Results may be incomplete.",
    depthLimit: "Some folders are too deep to search.",
  }[reason];
}
/** Validate Unicode scalars rather than UTF-16 code units. */
export function validFilter(query: string): boolean {
  return [...query].length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(query);
}
