import type { FileTreeEntryDto, FileTreePageDto, FileTreeSearchDto } from "@/bindings/files/files";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { FileExplorerProps } from "./file-explorer";

export const project: ProjectDto = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Fixture",
  rootPath: "X:/isolated-fixture",
  isPinned: false,
  addedAtMs: 0,
  lastOpenedAtMs: 0,
  availability: { status: "available" },
};
/** Make a pure DTO without touching a filesystem. */
export function entry(
  relativePath: string,
  kind: FileTreeEntryDto["kind"] = "file",
): FileTreeEntryDto {
  return { relativePath, name: relativePath.split("/").at(-1) ?? relativePath, kind };
}
/** Make a page with optional opaque pagination and diagnostics. */
export function page(
  directory = "",
  entries = [entry("src", "directory"), entry("readme.md")],
  overrides: Partial<FileTreePageDto> = {},
): FileTreePageDto {
  return {
    projectId: project.id,
    directory,
    entries,
    nextCursor: null,
    warnings: [],
    warningCount: 0,
    warningsTruncated: false,
    ...overrides,
  };
}
/** Make flat search results from inert relative identities. */
export function searchResult(
  query: string,
  matches = [entry(`deep/${query}.ts`)],
): FileTreeSearchDto {
  return {
    projectId: project.id,
    query,
    matches,
    warnings: [],
    warningCount: 0,
    warningsTruncated: false,
    truncatedReason: null,
  };
}
/** Expose a controllable completion without timers or native resources. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Supply inert route callbacks for isolated hooks and components. */
export function explorerProps(overrides: Partial<FileExplorerProps> = {}): FileExplorerProps {
  const boundary = { epoch: 0, suspended: false };
  return {
    sessionId: "22222222-2222-4222-8222-222222222222",
    projectId: project.id,
    isVisible: true,
    regionId: "fixture-explorer",
    platform: "windows",
    boundary,
    // Tests may replace this reader to simulate an owner change before React renders.
    readBoundary: () => boundary,
    // Recovery callbacks intentionally have no native or navigation effects in the fixture.
    onClose: () => {},
    onOpenProject: () => {},
    onProjectMissing: () => {},
    ...overrides,
  };
}
