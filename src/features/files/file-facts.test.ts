import { describe, expect, it } from "vitest";
import {
  formatByteSize,
  formatEncoding,
  formatLineCount,
  formatLineEnding,
  POLLING_FALLBACK_NOTE,
  watchModeNote,
} from "./file-facts";

describe("formatByteSize", () => {
  /** Byte counts below one kibibyte stay exact so tiny files never read as `0 KB`. */
  it("keeps small counts in bytes", () => {
    expect(formatByteSize(0n)).toBe("0 B");
    expect(formatByteSize(1n)).toBe("1 B");
    expect(formatByteSize(13n)).toBe("13 B");
    expect(formatByteSize(1023n)).toBe("1023 B");
  });

  /** One kibibyte switches units and keeps at most one fractional digit. */
  it("switches to KB at the kibibyte boundary", () => {
    expect(formatByteSize(1024n)).toBe("1 KB");
    expect(formatByteSize(1536n)).toBe("1.5 KB");
    expect(formatByteSize(1_048_575n)).toBe("1024 KB");
  });

  /** The syntax and viewer thresholds must read as round megabyte figures. */
  it("switches to MB at the mebibyte boundary", () => {
    expect(formatByteSize(1_048_576n)).toBe("1 MB");
    expect(formatByteSize(2_097_152n)).toBe("2 MB");
    expect(formatByteSize(5_242_880n)).toBe("5 MB");
    expect(formatByteSize(6_291_456n)).toBe("6 MB");
  });

  /**
   * Two counts one ulp apart at 2^70 collapse onto the same double, so a `Number`-based
   * implementation prints both as `1125899906842624 MB`. Exact `bigint` arithmetic must
   * keep them distinguishable.
   */
  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatByteSize(9_007_199_254_740_993n)).toBe("8589934592 MB");
    expect(formatByteSize(1_180_591_620_717_411_303_424n)).toBe("1125899906842624 MB");
    expect(formatByteSize(1_180_591_620_717_411_434_496n)).toBe("1125899906842624.1 MB");
  });
});

describe("formatLineCount", () => {
  /** The backend line count is printed verbatim with matching grammar. */
  it("uses singular only for exactly one line", () => {
    expect(formatLineCount(0)).toBe("0 lines");
    expect(formatLineCount(1)).toBe("1 line");
    expect(formatLineCount(2)).toBe("2 lines");
    expect(formatLineCount(212)).toBe("212 lines");
  });
});

describe("formatEncoding", () => {
  /** A detected byte-order mark is a separate fact the status bar must surface. */
  it("names the byte-order mark", () => {
    expect(formatEncoding("utf8", false)).toBe("UTF-8");
    expect(formatEncoding("utf8", true)).toBe("UTF-8 with BOM");
  });
});

describe("formatLineEnding", () => {
  /** A file with no line break has no meaningful style, so the cell disappears. */
  it("hides the cell for none and names every other style", () => {
    expect(formatLineEnding("none")).toBeNull();
    expect(formatLineEnding("lf")).toBe("LF");
    expect(formatLineEnding("crlf")).toBe("CRLF");
    expect(formatLineEnding("mixed")).toBe("Mixed");
  });
});

describe("watchModeNote", () => {
  /** Native watching is the silent default; only the fallback earns a note. */
  it("only annotates the polling fallback", () => {
    expect(watchModeNote("native")).toBeNull();
    expect(watchModeNote("pollingFallback")).toBe(POLLING_FALLBACK_NOTE);
  });
});
