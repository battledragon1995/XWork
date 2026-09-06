import type { DataManagementError } from "@/bindings/data-management";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { normalizeImportPreview } from "@/lib/ipc/data-management";

const COPY = {
  unauthorized_window: "Data management is only available in the main window.",
  operation_in_progress: "Another data operation is still running.",
  no_pending_operation: "This confirmation has expired. Prepare the operation again.",
  stale_request: "This confirmation has expired. Prepare the operation again.",
  invalid_reset_confirmation: "Type RESET to confirm.",
  data_location_unavailable: "Could not read the data location.",
  open_location_failed: "Could not open the data folder.",
  clipboard_write_failed: "Could not copy the path.",
  file_read_failed: "Could not read this backup. Choose another file.",
  file_write_failed: "The backup could not be saved. Try exporting again.",
  backup_too_large: "Backups must be 128 MiB or smaller.",
  invalid_backup: "This is not a valid XWork backup.",
  serialize_failed: "Could not create the backup.",
  snapshot_failed: "Could not create the backup.",
  import_preview_changed: "Data changed. Review the updated preview before importing.",
  runtime_unavailable: "Could not check running sessions. Try again.",
  runtime_cleanup_failed: "Some sessions may have stopped, but XWork data was not reset.",
  persistence_failed: "Could not complete the data operation.",
} satisfies Partial<Record<DataManagementError["code"], string>>;
const DOMAINS = {
  projects: "project",
  settings: "settings",
  cli_profiles: "CLI profile",
  keyboard_shortcuts: "keyboard shortcut",
  notes: "note",
  events: "calendar",
};
/** Reject unknown and malformed tagged payloads without displaying diagnostics. */
export function dataFailure(error: unknown): IpcCallError<DataManagementError> {
  if (error instanceof IpcCallError && error.payload) {
    const p = error.payload as DataManagementError;
    if (p.code === "import_preview_changed") {
      try {
        return new IpcCallError(error.command, {
          code: p.code,
          preview: normalizeImportPreview(p.preview),
        });
      } catch {
        /* Unsafe previews are uncertainty. */
      }
    } else if (
      Object.hasOwn(COPY, p.code) ||
      (p.code === "unsupported_backup_version" &&
        Number.isSafeInteger(p.found) &&
        p.found >= 0 &&
        Number.isSafeInteger(p.supported) &&
        p.supported >= 0) ||
      (p.code === "domain_validation_failed" && Object.hasOwn(DOMAINS, p.domain))
    )
      return error as IpcCallError<DataManagementError>;
  }
  return new IpcCallError<DataManagementError>("data_management", null);
}
/** Map only fixed copy and validated scalar metadata to user-visible errors. */
export function dataErrorCopy(error: unknown): string {
  const p = dataFailure(error).payload;
  if (!p) return "Could not confirm the result. Refresh views before starting another operation.";
  if (p.code === "unsupported_backup_version")
    return `Backup version ${p.found} is not supported. This XWork supports version ${p.supported}. Choose a supported backup.`;
  if (p.code === "domain_validation_failed")
    return `The backup contains invalid ${DOMAINS[p.domain]} data.`;
  return COPY[p.code];
}
/** Format valid backup dates without overflowing the browser Date range. */
export function backupDate(time: bigint): string {
  return time >= -8640000000000000n && time <= 8640000000000000n
    ? new Date(Number(time)).toLocaleString("en-US")
    : "Date unavailable";
}
