import { describe, expect, it } from "vitest";
import {
  classifySessionRevision,
  compareSessionRevisions,
  nextSessionRevision,
} from "./session-revision";

describe("compareSessionRevisions", () => {
  // Verify equal values compare equal, including across leading zeros.
  it.each([
    ["7", "7"],
    ["07", "7"],
    ["0", "00"],
  ])("reports %s and %s as equal", (left, right) => {
    expect(compareSessionRevisions(left, right)).toBe(0);
  });

  // Verify ordering is numeric rather than lexical, which is the whole point of the helper.
  it.each([
    ["9", "10"],
    ["99", "100"],
    ["1", "2"],
  ])("reports %s as older than %s", (older, newer) => {
    expect(compareSessionRevisions(older, newer)).toBeLessThan(0);
    expect(compareSessionRevisions(newer, older)).toBeGreaterThan(0);
  });

  // Verify a value far above the safe integer range still compares exactly, which a
  // `Number` conversion could not do.
  it("compares values beyond the safe integer range exactly", () => {
    const lower = "9007199254740993";
    const higher = "9007199254740994";

    expect(compareSessionRevisions(lower, higher)).toBeLessThan(0);
    expect(compareSessionRevisions(lower, lower)).toBe(0);
  });
});

describe("nextSessionRevision", () => {
  // Verify the ordinary increment.
  it.each([
    ["0", "1"],
    ["8", "9"],
    ["10", "11"],
  ])("increments %s to %s", (revision, expected) => {
    expect(nextSessionRevision(revision)).toBe(expected);
  });

  // Verify a carry across every digit grows the string instead of overflowing.
  it.each([
    ["9", "10"],
    ["99", "100"],
    ["18446744073709551615", "18446744073709551616"],
  ])("carries %s to %s", (revision, expected) => {
    expect(nextSessionRevision(revision)).toBe(expected);
  });
});

describe("classifySessionRevision", () => {
  // Verify a repeated or reordered delivery is recognized as stale.
  it.each([
    ["4", "4"],
    ["4", "3"],
    ["10", "9"],
  ])("classifies applied %s and incoming %s as stale", (applied, incoming) => {
    expect(classifySessionRevision(applied, incoming)).toBe("stale");
  });

  // Verify exactly one step ahead is applicable without a re-read.
  it.each([
    ["4", "5"],
    ["9", "10"],
    ["099", "100"],
  ])("classifies applied %s and incoming %s as next", (applied, incoming) => {
    expect(classifySessionRevision(applied, incoming)).toBe("next");
  });

  // Verify anything further ahead proves an event was missed.
  it.each([
    ["4", "6"],
    ["9", "11"],
    ["1", "9001"],
  ])("classifies applied %s and incoming %s as a gap", (applied, incoming) => {
    expect(classifySessionRevision(applied, incoming)).toBe("gap");
  });
});
