import type { SessionStatusDto, SessionSummaryDto } from "@/bindings/sessions/sessions";

/**
 * Visual tone of one status dot. It is deliberately not a colour: the same tone drives the
 * sidebar dot, the overview dot and the delete dialog, and every one of them also renders the
 * textual label below, so colour is never the only channel carrying the status.
 */
export type SessionStatusTone = "idle" | "running" | "unread" | "attention" | "done" | "error";

/** One tone and label pair per generated status, so a new backend status cannot go unmapped. */
const STATUS_DESCRIPTIONS: Record<SessionStatusDto, { tone: SessionStatusTone; label: string }> = {
  noToolYet: { tone: "idle", label: "No tool chosen" },
  running: { tone: "running", label: "Running" },
  unseenOutput: { tone: "unread", label: "New output" },
  needsAttention: { tone: "attention", label: "Needs attention" },
  finished: { tone: "done", label: "Finished" },
  exitedWithError: { tone: "error", label: "Exited with an error" },
};

/** Describe one session status as the dot tone plus the words a reader always gets. */
export function describeSessionStatus(status: SessionStatusDto): {
  tone: SessionStatusTone;
  label: string;
} {
  return STATUS_DESCRIPTIONS[status];
}

/**
 * Build the secondary line of one session row. The process clause is appended only for a
 * non-zero count, so the line never asks the reader to interpret "0 processes".
 */
export function describeSessionMeta(summary: SessionSummaryDto): string {
  const { label } = describeSessionStatus(summary.status);
  const tabs = summary.tabCount === 1 ? "1 tab" : `${summary.tabCount} tabs`;
  const line = `${label} · ${tabs}`;

  if (summary.runningProcessCount === 0) {
    return line;
  }

  const processes =
    summary.runningProcessCount === 1 ? "1 process" : `${summary.runningProcessCount} processes`;

  return `${line} · ${processes}`;
}
