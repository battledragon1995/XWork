import { describe, expect, it } from "vitest";
import type { SessionStatusDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { describeSessionMeta, describeSessionStatus } from "./session-status";

/** Build one summary whose counts a case overrides. */
function summary(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    id: "s1",
    projectId: "p1",
    name: "New Session",
    status: "noToolYet",
    runningProcessCount: 0,
    tabCount: 0,
    ...overrides,
  };
}

describe("describeSessionStatus", () => {
  // Verify all six generated statuses map to the exact FE-006 tone and label pair, so a dot
  // is never the only way to read a status.
  it.each<[SessionStatusDto, string, string]>([
    ["noToolYet", "idle", "No tool chosen"],
    ["running", "running", "Running"],
    ["unseenOutput", "unread", "New output"],
    ["needsAttention", "attention", "Needs attention"],
    ["finished", "done", "Finished"],
    ["exitedWithError", "error", "Exited with an error"],
  ])("maps %s to the %s tone", (status, tone, label) => {
    expect(describeSessionStatus(status)).toEqual({ tone, label });
  });
});

describe("describeSessionMeta", () => {
  // Verify the tab count is singular at exactly one tab.
  it("uses the singular tab noun for one tab", () => {
    expect(describeSessionMeta(summary({ tabCount: 1 }))).toBe("No tool chosen · 1 tab");
  });

  // Verify zero tabs still reads as a plural, which is what an empty session shows.
  it("uses the plural tab noun for zero tabs", () => {
    expect(describeSessionMeta(summary())).toBe("No tool chosen · 0 tabs");
  });

  // Verify several tabs read as a plural.
  it("uses the plural tab noun for several tabs", () => {
    expect(describeSessionMeta(summary({ tabCount: 3 }))).toBe("No tool chosen · 3 tabs");
  });

  // Verify a running process appends its own singular clause after the tab clause.
  it("appends one running process in the singular", () => {
    expect(
      describeSessionMeta(summary({ status: "running", tabCount: 1, runningProcessCount: 1 })),
    ).toBe("Running · 1 tab · 1 process");
  });

  // Verify several running processes append a plural clause.
  it("appends several running processes in the plural", () => {
    expect(
      describeSessionMeta(summary({ status: "running", tabCount: 2, runningProcessCount: 4 })),
    ).toBe("Running · 2 tabs · 4 processes");
  });

  // Verify no process clause appears while nothing is running, so the line never claims a
  // count of zero the user would have to interpret.
  it("omits the process clause when nothing is running", () => {
    expect(describeSessionMeta(summary({ status: "finished", tabCount: 2 }))).toBe(
      "Finished · 2 tabs",
    );
  });
});
