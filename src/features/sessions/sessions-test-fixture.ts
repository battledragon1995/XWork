import type { ProjectDto } from "@/bindings/projects/projects";
import type { CliProfileDto, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import type { ToolCatalogData } from "./use-tool-catalog";
import type {
  CloseImpactDto,
  CloseTargetDto,
  PaneDto,
  PaneLayoutNodeDto,
  SessionDetailDto,
  SessionRuntimeEventDto,
  SessionSummaryDto,
  TabDto,
} from "@/bindings/sessions/sessions";

/**
 * Deterministic identifiers every focused test shares. They are opaque sentinels, never a
 * real project id, so a captured assertion or a DOM snapshot exposes nothing about the user.
 */
export const FIXTURE_PROJECT_ID = "project-alpha";
export const FIXTURE_OTHER_PROJECT_ID = "project-beta";
export const FIXTURE_SESSION_ID = "session-1";
export const FIXTURE_TAB_ID = "tab-1";
export const FIXTURE_PANE_ID = "pane-1";

/** A fixed root path that looks like a Windows path without naming a real folder. */
export const FIXTURE_ROOT_PATH = "D:\\Fixtures\\alpha";

/** Build one project DTO, used only for the route's `Starts in …` line and crumb label. */
export function createProjectDto(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: FIXTURE_PROJECT_ID,
    displayName: "alpha",
    rootPath: FIXTURE_ROOT_PATH,
    isPinned: false,
    addedAtMs: 1_700_000_000_000,
    lastOpenedAtMs: 1_700_000_000_000,
    availability: { status: "available" },
    ...overrides,
  };
}

/** Build one session summary in its freshly created, tool-less state. */
export function createSessionSummary(
  overrides: Partial<SessionSummaryDto> = {},
): SessionSummaryDto {
  return {
    id: FIXTURE_SESSION_ID,
    projectId: FIXTURE_PROJECT_ID,
    name: "New Session",
    status: "noToolYet",
    runningProcessCount: 0,
    tabCount: 0,
    ...overrides,
  };
}

/** Build one pane carrying the only content FE-006 can create. */
export function createToolSelectionPane(profileId: string, title: string): PaneDto {
  return { id: FIXTURE_PANE_ID, content: { kind: "toolSelection", profileId, title } };
}

/** Build one pane with caller-selected content for layout and placeholder tests. */
export function createPaneDto(overrides: Partial<PaneDto> = {}): PaneDto {
  return { id: FIXTURE_PANE_ID, content: { kind: "empty" }, ...overrides };
}

/** Build one two-leaf layout with the requested backend axis and ratio. */
export function createSplitLayout(
  overrides: Partial<Extract<PaneLayoutNodeDto, { kind: "split" }>> = {},
): PaneLayoutNodeDto {
  return {
    kind: "split",
    splitId: "split-1",
    axis: "vertical",
    ratioBasisPoints: 5000,
    first: { kind: "pane", pane: createPaneDto() },
    second: { kind: "pane", pane: createPaneDto({ id: "pane-2" }) },
    ...overrides,
  };
}

/** Build one tab whose single pane holds a chosen tool. */
export function createTabDto(overrides: Partial<TabDto> = {}): TabDto {
  const pane = createToolSelectionPane("builtin:codex", "Codex");

  return {
    id: FIXTURE_TAB_ID,
    name: "Codex",
    layout: { kind: "pane", pane },
    activePaneId: pane.id,
    maximizedPaneId: null,
    ...overrides,
  };
}

/** Build one deterministic CLI profile without reading the developer's catalog. */
export function createCliProfileDto(overrides: Partial<CliProfileDto> = {}): CliProfileDto {
  return {
    id: "builtin:codex",
    name: "Codex",
    kind: "builtIn",
    command: "codex",
    arguments: [],
    shellId: null,
    effectiveShellId: "shell:cmd",
    icon: "CX",
    color: "#cc785c",
    environment: [],
    availability: { status: "available", checkedAtUnixMs: "1700000000000" },
    ...overrides,
  };
}

/** Build a complete isolated catalog snapshot for picker and pane tests. */
export function createCliProfilesSnapshot(
  overrides: Partial<CliProfilesSnapshotDto> = {},
): CliProfilesSnapshotDto {
  return {
    revision: "4",
    defaultShellId: "shell:cmd",
    effectiveDefaultShellId: "shell:cmd",
    shells: [],
    profiles: [createCliProfileDto()],
    ...overrides,
  };
}

/** Build a ready catalog seam that performs no backend or event operation. */
export function createToolCatalogData(overrides: Partial<ToolCatalogData> = {}): ToolCatalogData {
  return {
    status: "ready",
    snapshot: createCliProfilesSnapshot(),
    checkingProfileIds: new Set<string>(),
    unavailableProfileIds: new Set<string>(),
    failure: null,
    refresh: () => {},
    check: async () => {},
    markUnavailable: () => {},
    ...overrides,
  };
}

/** Build the close target for one fixture tab. */
export function createTabCloseTarget(): CloseTargetDto {
  return { kind: "tab", sessionId: FIXTURE_SESSION_ID, tabId: FIXTURE_TAB_ID };
}

/** Build the close target for one fixture pane. */
export function createPaneCloseTarget(): CloseTargetDto {
  return {
    kind: "pane",
    sessionId: FIXTURE_SESSION_ID,
    tabId: FIXTURE_TAB_ID,
    paneId: FIXTURE_PANE_ID,
  };
}

/** Build the empty-session snapshot the tool picker renders for. */
export function createSessionDetail(overrides: Partial<SessionDetailDto> = {}): SessionDetailDto {
  return {
    summary: createSessionSummary(),
    tabs: [],
    activeTabId: null,
    canReopenLastClosedTab: false,
    revision: "10",
    ...overrides,
  };
}

/** Build the snapshot of a session that already has one tab, so FE-007's slot is rendered. */
export function createNonEmptySessionDetail(
  overrides: Partial<SessionDetailDto> = {},
): SessionDetailDto {
  const tab = createTabDto();

  return createSessionDetail({
    summary: createSessionSummary({ status: "running", tabCount: 1, runningProcessCount: 1 }),
    tabs: [tab],
    activeTabId: tab.id,
    revision: "11",
    ...overrides,
  });
}

/** The only close target FE-006 ever builds. */
export function createSessionCloseTarget(sessionId = FIXTURE_SESSION_ID): CloseTargetDto {
  return { kind: "session", sessionId };
}

/** Build one close impact with no measured blockers, which is the Stage 8 default. */
export function createCloseImpact(overrides: Partial<CloseImpactDto> = {}): CloseImpactDto {
  return {
    target: createSessionCloseTarget(),
    requiresConfirmation: true,
    runningProcessCount: 0,
    runningProcessLabels: [],
    unsavedFileCount: 0,
    unsavedFileLabels: [],
    ...overrides,
  };
}

/** Build one committed runtime event. `revision` is a decimal string, never a number. */
export function createRuntimeEvent(
  overrides: Partial<SessionRuntimeEventDto> = {},
): SessionRuntimeEventDto {
  const summary = overrides.summary === undefined ? createSessionSummary() : overrides.summary;

  return {
    revision: "1",
    change: "created",
    projectId: summary?.projectId ?? FIXTURE_PROJECT_ID,
    sessionId: summary?.id ?? FIXTURE_SESSION_ID,
    ...overrides,
    summary,
  };
}
