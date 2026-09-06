import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionStatusDto, SessionSummaryDto } from "@/bindings/sessions/sessions";

export const STATUS_LABELS: Record<SessionStatusDto, string> = {
  needsAttention: "Needs attention",
  exitedWithError: "Exited with error",
  unseenOutput: "Unseen output",
  running: "Running",
  noToolYet: "No tool yet",
  finished: "Finished",
};
const PRIORITY: SessionStatusDto[] = [
  "needsAttention",
  "exitedWithError",
  "unseenOutput",
  "running",
  "noToolYet",
  "finished",
];

/** Sort a copy by recency without changing the Projects owner's pin ordering. */
export function recentProjects(projects: ProjectDto[]) {
  return [...projects]
    .sort(
      /** Apply deterministic timestamp and opaque identity ties. */
      (a, b) =>
        b.lastOpenedAtMs - a.lastOpenedAtMs ||
        b.addedAtMs - a.addedAtMs ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, 5);
}
/** Preserve backend ordering inside each attention group. */
export function orderedSessions(sessions: SessionSummaryDto[]) {
  return [...sessions].sort(
    /** Compare only attention priority, preserving ties. */ (a, b) =>
      PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status),
  );
}
/** Count running sessions and attention independently because the groups overlap. */
export function sessionCounts(sessions: SessionSummaryDto[]) {
  return {
    running: sessions.filter(
      /** Count sessions with any live process. */ (session) => session.runningProcessCount > 0,
    ).length,
    attention: sessions.filter(
      /** Count the attention subset independently. */ (session) =>
        session.status === "needsAttention",
    ).length,
  };
}
/** Format an absolute local timestamp with no inferred elapsed runtime. */
export function projectTimestamp(project: ProjectDto) {
  return `${project.addedAtMs === project.lastOpenedAtMs ? "Added" : "Opened"} ${new Date(project.lastOpenedAtMs).toLocaleString("en-GB")}`;
}
/** Format the local calendar day in the initial English UI language. */
export function homeDate(date: Date) {
  return `${date.toLocaleDateString("en-GB", { weekday: "long" })}, ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}
