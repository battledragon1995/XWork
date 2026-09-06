import { expect, it } from "vitest";
import type { FilesError } from "@/bindings/files/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { fileErrorCopy, truncationCopy, validFilter, warningCopy } from "./file-error-copy";

const codes: FilesError["code"][] = [
  "windowNotAllowed",
  "invalidProjectId",
  "projectNotFound",
  "projectUnavailable",
  "projectRemovalInProgress",
  "projectAccessFailed",
  "invalidRelativePath",
  "invalidSearch",
  "invalidCursor",
  "entryNotFound",
  "entryNotVisible",
  "notDirectory",
  "notRegularFile",
  "linkTraversalDenied",
  "traversalLimitExceeded",
  "fileSystemReadFailed",
  "invalidSessionTarget",
  "paneNotEmpty",
  "sessionAttachFailed",
  "invalidFileHandleId",
  "fileHandleNotFound",
  "revisionConflict",
  "noExternalConflict",
  "fileChangedAgain",
  "unsavedChangesWouldBeLost",
  "fileChangedDuringRead",
  "fileReadFailed",
  "fileMemoryLimitReached",
  "projectRootChanged",
  "revealFailed",
  "invalidLimit",
  "recentFilesFailed",
  "clockFailed",
  "openExternalFailed",
];
// Every generated error code must have intentional safe English copy.
it.each(codes)("maps %s without exposing payload paths", (code) => {
  const copy = fileErrorCopy(new IpcCallError("files", { code, relative_path: "private-path" }));
  expect(copy).not.toContain("private-path");
  expect(copy).not.toContain("Could not complete");
});
// Unknown transport text is never rendered to the user.
it("uses safe unknown and search copy", () => {
  expect(fileErrorCopy(new Error("secret"))).toBe(
    "Could not complete this file action. Try again.",
  );
  expect(fileErrorCopy(new IpcCallError("search", { code: "fileSystemReadFailed" }), true)).toBe(
    "Could not search files.",
  );
});
// All public diagnostic variants have truthful nonempty explanations.
it("maps all warnings and truncation reasons", () => {
  for (const reason of ["unreadableEntry", "invalidIgnoreRule", "unsupportedName"] as const)
    expect(warningCopy(reason)).toMatch(/Some/);
  for (const reason of ["resultLimit", "scanLimit", "depthLimit"] as const)
    expect(truncationCopy(reason).length).toBeGreaterThan(15);
  expect(validFilter("\ud800")).toBe(false);
});
