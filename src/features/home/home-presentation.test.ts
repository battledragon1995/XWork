import { describe, expect, it } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionStatusDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import {
  homeDate,
  orderedSessions,
  projectTimestamp,
  recentProjects,
  STATUS_LABELS,
  sessionCounts,
} from "./home-presentation";

/** Build a complete query DTO without accessing persistence. */
function project(id: string, opened = 1, added = 1): ProjectDto {
  return {
    id,
    displayName: id,
    rootPath: `C:/fixtures/${id}`,
    addedAtMs: added,
    lastOpenedAtMs: opened,
    isPinned: false,
    availability: { status: "available" },
  };
}
/** Build a runtime summary whose process count is independent of aggregate status. */
function session(id: string, status: SessionStatusDto, processes = 0): SessionSummaryDto {
  return { id, projectId: "p", name: id, status, runningProcessCount: processes, tabCount: 2 };
}
// Cover immutable ordering and honest timestamp/status projections.
describe("Home presentation", () => {
  // Recent does not manufacture rows for small lists.
  it.each([0, 1])("retains %i recent rows", (count) => {
    const rows = Array.from({ length: count }, (_, index) => project(`${index}`));
    expect(recentProjects(rows)).toEqual(rows);
  });
  // Pinning in Projects must not displace a recently opened project on Home.
  it("limits six projects to five by recency and leaves the input unchanged", () => {
    const rows = [
      { ...project("old"), isPinned: true },
      ...Array.from({ length: 5 }, (_, index) => project(`${index}`, index + 10)),
    ];
    expect(recentProjects(rows).map((row) => row.id)).toEqual(["4", "3", "2", "1", "0"]);
    expect(rows[0]?.id).toBe("old");
  });
  // Added timestamps and IDs break ties without locale-dependent opaque ID ordering.
  it("resolves timestamp ties deterministically", () => {
    expect(
      recentProjects([project("b", 5, 2), project("a", 5, 2), project("c", 5, 3)]).map(
        (row) => row.id,
      ),
    ).toEqual(["c", "a", "b"]);
  });
  // All six states remain visible with stable backend order inside a status group.
  it("orders every status and retains backend ties", () => {
    const rows = [
      session("f", "finished"),
      session("n", "noToolYet"),
      session("r", "running"),
      session("u", "unseenOutput"),
      session("e", "exitedWithError"),
      session("a", "needsAttention"),
      session("a2", "needsAttention"),
    ];
    expect(orderedSessions(rows).map((row) => row.id)).toEqual([
      "a",
      "a2",
      "e",
      "u",
      "r",
      "n",
      "f",
    ]);
    expect(rows[0]?.id).toBe("f");
    expect(Object.values(STATUS_LABELS)).toHaveLength(6);
  });
  // A session can need attention and still contain several running processes.
  it("counts sessions independently from aggregate status and process totals", () => {
    expect(
      sessionCounts([
        session("a", "needsAttention", 3),
        session("e", "exitedWithError", 1),
        session("r", "running", 0),
      ]),
    ).toEqual({ running: 2, attention: 1 });
    expect(sessionCounts([])).toEqual({ running: 0, attention: 0 });
  });
  // Equal timestamps use Added without asserting that the project was never opened.
  it("formats absolute local timestamps and the English calendar day", () => {
    const now = new Date(2026, 8, 6, 12).getTime();
    expect(projectTimestamp(project("p", now, now))).toBe(
      `Added ${new Date(now).toLocaleString("en-GB")}`,
    );
    expect(projectTimestamp(project("p", now, now - 1))).toBe(
      `Opened ${new Date(now).toLocaleString("en-GB")}`,
    );
    expect(homeDate(new Date(now))).toBe("Sunday, 6 September");
  });
});
