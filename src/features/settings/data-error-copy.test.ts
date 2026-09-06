import { expect, it } from "vitest";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { backupDate, dataErrorCopy, dataFailure } from "./data-error-copy";
/** All simple native codes map to fixed copy instead of backend text. */
it.each([
  "unauthorized_window",
  "operation_in_progress",
  "no_pending_operation",
  "stale_request",
  "invalid_reset_confirmation",
  "data_location_unavailable",
  "open_location_failed",
  "clipboard_write_failed",
  "file_read_failed",
  "file_write_failed",
  "backup_too_large",
  "invalid_backup",
  "serialize_failed",
  "snapshot_failed",
  "runtime_unavailable",
  "runtime_cleanup_failed",
  "persistence_failed",
])("redacts %s", (code) => {
  const error = new IpcCallError("test", { code, diagnostic: "SECRET" });
  expect(dataFailure(error).payload?.code).toBe(code);
  expect(dataErrorCopy(error)).not.toContain("SECRET");
  expect(dataErrorCopy(error)).not.toContain("Could not confirm the result");
});
/** Validate scalars and nested objects before accepting typed error shapes. */
it.each([
  { code: "future" },
  { code: "unsupported_backup_version", found: "SECRET", supported: 1 },
  { code: "domain_validation_failed", domain: "SECRET" },
  { code: "import_preview_changed", preview: {} },
])("rejects malformed tagged payload %#", (payload) => {
  expect(dataFailure(new IpcCallError("test", payload)).payload).toBeNull();
});
/** Supported metadata receives explicit safe copy, including version zero. */
it("shows validated versions and domain labels", () => {
  expect(
    dataErrorCopy(
      new IpcCallError("test", { code: "unsupported_backup_version", found: 0, supported: 1 }),
    ),
  ).toContain("version 0");
  expect(
    dataErrorCopy(
      new IpcCallError("test", { code: "domain_validation_failed", domain: "cli_profiles" }),
    ),
  ).toContain("CLI profile");
  expect(backupDate(8640000000000001n)).toBe("Date unavailable");
  expect(backupDate(0n)).not.toBe("Date unavailable");
});
