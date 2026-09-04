import { beforeEach, describe, expect, it } from "vitest";
import {
  formatUsedAt,
  readRecentTools,
  recordToolUse,
  resetRecentTools,
} from "./recent-tools-store";

/** A fixed clock, so every recorded moment in a case is deliberate. */
const NOW = 1_700_000_000_000;

beforeEach(() => {
  resetRecentTools();
});

describe("recent tool usage", () => {
  // Verify a run starts with nothing, which is why the block is hidden at first.
  it("starts empty", () => {
    expect(readRecentTools(4)).toEqual([]);
  });

  // Verify the newest pick comes first, so the block reads as a history.
  it("orders the newest pick first", () => {
    recordToolUse("builtin:codex", NOW);
    recordToolUse("builtin:claude", NOW + 1_000);

    expect(readRecentTools(4).map((entry) => entry.profileId)).toEqual([
      "builtin:claude",
      "builtin:codex",
    ]);
  });

  // Verify a profile picked again moves to the front instead of appearing twice.
  it("deduplicates a repeated profile", () => {
    recordToolUse("builtin:codex", NOW);
    recordToolUse("builtin:claude", NOW + 1_000);
    recordToolUse("builtin:codex", NOW + 2_000);

    const entries = readRecentTools(4);
    expect(entries.map((entry) => entry.profileId)).toEqual(["builtin:codex", "builtin:claude"]);
    expect(entries[0]?.usedAtMs).toBe(NOW + 2_000);
  });

  // Verify the list never grows past four entries, so an old pick cannot linger all run.
  it("keeps at most four entries", () => {
    for (const [index, id] of ["a", "b", "c", "d", "e"].entries()) {
      recordToolUse(id, NOW + index * 1_000);
    }

    expect(readRecentTools(10).map((entry) => entry.profileId)).toEqual(["e", "d", "c", "b"]);
  });

  // Verify a caller may ask for fewer entries than the cap.
  it("honours a smaller limit", () => {
    recordToolUse("a", NOW);
    recordToolUse("b", NOW + 1_000);

    expect(readRecentTools(1).map((entry) => entry.profileId)).toEqual(["b"]);
  });

  // Verify a non-positive limit reads nothing rather than throwing.
  it("reads nothing for a zero limit", () => {
    recordToolUse("a", NOW);

    expect(readRecentTools(0)).toEqual([]);
  });

  // Verify the recorded moment is kept verbatim, so the label is computed and never guessed.
  it("keeps the recorded moment", () => {
    recordToolUse("a", NOW);

    expect(readRecentTools(1)[0]).toEqual({ profileId: "a", usedAtMs: NOW });
  });
});

describe("formatUsedAt", () => {
  // Verify the whole first minute reads as `just now`, including its exact last millisecond.
  it.each([
    ["the same moment", 0],
    ["one second", 1_000],
    ["59.999 seconds", 59_999],
  ])("reports %s as just now", (_label, elapsedMs) => {
    expect(formatUsedAt(NOW - elapsedMs, NOW)).toBe("just now");
  });

  // Verify the minute boundary switches to minutes and counts down whole minutes only.
  it.each([
    ["exactly one minute", 60_000, "1m ago"],
    ["five minutes", 5 * 60_000, "5m ago"],
    ["59 minutes and 59 seconds", 59 * 60_000 + 59_000, "59m ago"],
  ])("reports %s as %s", (_label, elapsedMs, expected) => {
    expect(formatUsedAt(NOW - elapsedMs, NOW)).toBe(expected);
  });

  // Verify the hour boundary switches to hours and counts down whole hours only.
  it.each([
    ["exactly one hour", 3_600_000, "1h ago"],
    ["two and a half hours", 2.5 * 3_600_000, "2h ago"],
    ["25 hours", 25 * 3_600_000, "25h ago"],
  ])("reports %s as %s", (_label, elapsedMs, expected) => {
    expect(formatUsedAt(NOW - elapsedMs, NOW)).toBe(expected);
  });

  // Verify a moment in the future never produces a negative label, which a clock change or a
  // rounding difference could otherwise cause.
  it("reports a future moment as just now", () => {
    expect(formatUsedAt(NOW + 10_000, NOW)).toBe("just now");
  });
});
