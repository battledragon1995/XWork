import type {
  FileDiskVersionDto,
  FileHandleChangedEventDto,
  FileHandleDto,
  FileHandleStateDto,
  FileTreeEntryDto,
  FileTreePageDto,
  FileTreeSearchDto,
  OpenFileResultDto,
  OpenFileWarningDto,
  TextFileDto,
} from "@/bindings/files/files";
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
    placements: { newTab: true, emptyPane: true, splitRight: true, splitDown: true },
    // Tests may replace this reader to simulate an owner change before React renders.
    readBoundary: () => boundary,
    // The host answers with no target unless a case supplies its own preparation.
    prepareTarget: async () => null,
    onFileOpened: () => {},
    // Recovery callbacks intentionally have no native or navigation effects in the fixture.
    onClose: () => {},
    onOpenProject: () => {},
    onProjectMissing: () => {},
    ...overrides,
  };
}

/** Viewer byte limit BE-014 reports for oversized content. */
export const VIEWER_LIMIT_BYTES = 5_242_880n;

/** Make one inert observed disk version; no filesystem is touched. */
export function diskVersion(overrides: Partial<FileDiskVersionDto> = {}): FileDiskVersionDto {
  return {
    diskRevision: "disk-1",
    observedAtMs: 1_000n,
    modifiedAtMs: 900n,
    byteSize: 12n,
    mimeType: "text/plain",
    ...overrides,
  };
}
/** Make one in-memory text snapshot with backend-authoritative facts. */
export function textFile(overrides: Partial<TextFileDto> = {}): TextFileDto {
  return {
    text: "fn main() {}\n",
    byteSize: 13n,
    lineCount: 1,
    mimeType: "text/x-rust",
    syntaxHint: "rs",
    encoding: "utf8",
    hasUtf8Bom: false,
    lineEnding: "lf",
    mode: "sourceReadOnly",
    ...overrides,
  };
}
/** Make a ready text state, the common case every viewer test starts from. */
export function readyTextState(file: Partial<TextFileDto> = {}): FileHandleStateDto {
  return { kind: "ready", content: { kind: "text", file: textFile(file) }, disk: diskVersion() };
}
/** Make a ready binary state that never exposes raw bytes to the frontend. */
export function readyBinaryState(byteSize = 4_096n, mimeType = "image/png"): FileHandleStateDto {
  return {
    kind: "ready",
    content: { kind: "binary", byteSize, mimeType },
    disk: diskVersion({ byteSize, mimeType }),
  };
}
/** Make a ready state whose content exceeds the viewer limit reported by the backend. */
export function readyTooLargeState(
  byteSize = 6_291_456n,
  limitBytes = VIEWER_LIMIT_BYTES,
): FileHandleStateDto {
  return {
    kind: "ready",
    content: { kind: "tooLarge", byteSize, limitBytes, mimeType: "text/plain" },
    disk: diskVersion({ byteSize }),
  };
}
/** Make a missing state that may still carry the previously read content. */
export function missingState(local: TextFileDto | null = textFile()): FileHandleStateDto {
  return { kind: "missing", lastDisk: diskVersion(), local };
}
/** Make an unreadable state that may still carry the previously read content. */
export function unreadableState(local: TextFileDto | null = textFile()): FileHandleStateDto {
  return { kind: "unreadable", lastDisk: diskVersion(), local };
}
/** Make the state produced when the owning project points at a different root. */
export function projectRootChangedState(): FileHandleStateDto {
  return { kind: "projectRootChanged" };
}
/** Make the defensive conflict state a read-only handle is not expected to reach. */
export function externalConflictState(local: Partial<TextFileDto> = {}): FileHandleStateDto {
  return { kind: "externalConflict", local: textFile(local), external: diskVersion() };
}
/** Make one handle snapshot; `revision` stays a decimal string like the backend sends it. */
export function handle(overrides: Partial<FileHandleDto> = {}): FileHandleDto {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    projectId: project.id,
    sessionId: "22222222-2222-4222-8222-222222222222",
    tabId: "44444444-4444-4444-8444-444444444444",
    paneId: "55555555-5555-4555-8555-555555555555",
    name: "main.rs",
    relativePath: "src/main.rs",
    revision: "1",
    watchMode: "native",
    isDirty: false,
    dirtySinceMs: null,
    editCount: 0,
    state: readyTextState(),
    ...overrides,
  };
}
/** Make one attach result, optionally carrying the bounded post-attach warning. */
export function openResult(
  overrides: Partial<FileHandleDto> = {},
  warnings: OpenFileWarningDto[] = [],
): OpenFileResultDto {
  return { file: handle(overrides), warnings };
}
/** Make one invalidation event; the payload never carries file content. */
export function handleChangedEvent(
  overrides: Partial<FileHandleChangedEventDto> = {},
): FileHandleChangedEventDto {
  return {
    fileHandleId: handle().id,
    revision: "2",
    change: "reloaded",
    ...overrides,
  };
}
