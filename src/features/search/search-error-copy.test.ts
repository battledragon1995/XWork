import { expect, it } from "vitest";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { searchErrorCopy, sourceFailureCopy } from "./search-error-copy";

/** Exercise every public error without reflecting backend details. */
it.each([
  ["invalid_query", "Use up to 128 characters and remove control characters."],
  ["invalid_context_project_id", "Search context is unavailable."],
  ["unauthorized_window", "Search is only available in the main window."],
  ["unavailable", "Could not search. Try again."],
  ["private-path", "Could not search. Try again."],
])("sanitizes %s", (code, copy) => {
  expect(searchErrorCopy(new IpcCallError("search_unified", { code }))).toBe(copy);
});
/** Unknown transport content never reaches the surface. */
it("sanitizes transport failures", () => {
  expect(searchErrorCopy(new Error("secret"))).toBe("Could not search. Try again.");
});
/** Label each source and both failure reasons. */
it.each(["projects", "sessions", "commands"] as const)("labels %s failures", (source) => {
  expect(sourceFailureCopy({ source, reason: "timeout" })).toContain("Timed out");
  expect(sourceFailureCopy({ source, reason: "unavailable" })).toContain("Unavailable");
});
