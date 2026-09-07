import { expect, it } from "vitest";
import type { FilesError } from "@/bindings/files/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  fileErrorCopy,
  openedFileCopy,
  openingFileCopy,
  PANE_LIMIT_EXPLANATION,
  PLACEMENT_LABELS,
  recentNotRecordedCopy,
  truncationCopy,
  validFilter,
  warningCopy,
} from "./file-error-copy";

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

// Each placement has its own menu label and its own completed-opening announcement.
it.each([
  { placement: "newTab" as const, label: "Open in new tab", copy: "Opened a.ts in a new tab." },
  {
    placement: "emptyPane" as const,
    label: "Open in empty pane",
    copy: "Opened a.ts in the empty pane.",
  },
  {
    placement: "splitRight" as const,
    label: "Split right and open",
    copy: "Opened a.ts in a new pane on the right.",
  },
  {
    placement: "splitDown" as const,
    label: "Split down and open",
    copy: "Opened a.ts in a new pane below.",
  },
])("describes the $placement placement", ({ placement, label, copy }) => {
  expect(PLACEMENT_LABELS[placement]).toBe(label);
  expect(openedFileCopy(placement, "a.ts")).toBe(copy);
});

// A recorded-recents failure and a pending opening keep their own distinct sentences.
it("separates a pending opening from a warned success", () => {
  expect(openingFileCopy("a.ts")).toBe("Opening a.ts…");
  expect(recentNotRecordedCopy("a.ts")).toBe("Opened a.ts. Recent files couldn't be updated.");
  expect(PANE_LIMIT_EXPLANATION).toBe("A tab can hold up to 4 panes.");
});
