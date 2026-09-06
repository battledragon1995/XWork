import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BackupExportOutcomeDto,
  BackupImportPreviewDto,
  BackupImportResultDto,
  DataChangedEventDto,
  DataLocationDto,
  DataManagementError,
  PrepareBackupImportOutcomeDto,
  ResetImpactDto,
  ResetResultDto,
} from "@/bindings/data-management";
import { invokeCommand, IpcCallError } from "./ipc-error";

/** Validate numeric counts without coercing malformed native payloads. */
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Normalize the sole i64 field and validate previews before exposing a confirmation. */
export function normalizeImportPreview(value: unknown): BackupImportPreviewDto {
  if (typeof value !== "object" || value === null) throw new Error("Invalid preview");
  const p = value as BackupImportPreviewDto;
  const time: unknown = p.createdAtMs;
  if (
    !count(p.requestId) ||
    p.requestId > 4294967295 ||
    !count(p.schemaVersion) ||
    typeof p.sourceAppVersion !== "string" ||
    !p.counts ||
    !p.merge ||
    ![
      p.counts.projects,
      p.counts.customCliProfiles,
      p.counts.secretReferences,
      p.counts.keyboardShortcutOverrides,
      p.merge.inserts,
      p.merge.updates,
      p.merge.unchanged,
      p.merge.removals,
      p.merge.projectPathMatches,
    ].every(count) ||
    ![p.counts.notes, p.counts.events].every(
      /** Accept deferred sections explicitly. */ (n) => n === null || count(n),
    ) ||
    !(typeof time === "bigint" || (typeof time === "number" && Number.isSafeInteger(time)))
  )
    throw new Error("Invalid preview");
  return { ...p, createdAtMs: BigInt(time) };
}
/** Preserve typed failures while refusing malformed replacement previews. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invokeCommand<T, DataManagementError>(command, args);
  } catch (error) {
    if (error instanceof IpcCallError && error.payload?.code === "import_preview_changed") {
      let preview: BackupImportPreviewDto;
      try {
        preview = normalizeImportPreview(error.payload.preview);
      } catch {
        throw new IpcCallError<DataManagementError>(command, null);
      }
      throw new IpcCallError<DataManagementError>(command, {
        code: "import_preview_changed",
        preview,
      });
    }
    throw error;
  }
}
/** Read the backend-owned directory. */
export const getDataLocation = () => call<DataLocationDto>("get_data_location");
/** Open the backend-owned directory without a caller path. */
export const openDataLocation = () => call<void>("open_data_location");
/** Copy the backend-owned directory without web clipboard access. */
export const copyDataLocation = () => call<void>("copy_data_location");
/** Ask the backend to export through its native save dialog. */
export const exportBackup = () => call<BackupExportOutcomeDto>("export_backup");
/** Select a backup and normalize its immutable confirmation preview. */
export async function prepareImportBackup(): Promise<PrepareBackupImportOutcomeDto> {
  const result = await call<PrepareBackupImportOutcomeDto>("prepare_import_backup");
  if (result.kind === "cancelled") return result;
  try {
    return { kind: "ready", preview: normalizeImportPreview(result.preview) };
  } catch {
    throw new IpcCallError<DataManagementError>("prepare_import_backup", null);
  }
}
/** Confirm only the request the user reviewed. */
export const confirmImportBackup = (requestId: number) =>
  call<BackupImportResultDto>("confirm_import_backup", { requestId });
/** Read reset impact before destructive confirmation. */
export const prepareResetXwork = () => call<ResetImpactDto>("prepare_reset_xwork");
/** Send the explicit destructive confirmation unchanged. */
export const confirmResetXwork = (requestId: number, confirmation: string) =>
  call<ResetResultDto>("confirm_reset_xwork", { requestId, confirmation });
/** Retire exactly one pending backend request. */
export const cancelDataOperation = (requestId: number) =>
  call<void>("cancel_data_operation", { requestId });
/** Subscribe to committed invalidations, ignoring unsupported future kinds. */
export function onDataChanged(callback: (event: DataChangedEventDto) => void): Promise<UnlistenFn> {
  return listen<DataChangedEventDto>(
    "data://changed",
    /** Unwrap only the documented aggregate event. */ (event) => {
      if (event.payload.kind === "app_reset" || event.payload.kind === "backup_imported")
        callback(event.payload);
    },
  );
}
