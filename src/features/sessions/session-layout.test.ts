import { describe, expect, it } from "vitest";
import { createSplitLayout } from "./sessions-test-fixture";
import {
  clampRatioBasisPoints,
  countPanes,
  findPane,
  flattenPanes,
  paneIndex,
  percentToRatioBasisPoints,
  ratioToPercent,
  resolveMoveBeforeTabId,
} from "./session-layout";

describe("session layout helpers", () => {
  // Verify tree traversal preserves the backend's first-before-second invariant.
  it("flattens and finds panes in leaf order", () => {
    const layout = createSplitLayout();
    expect(flattenPanes(layout).map((pane) => pane.id)).toEqual(["pane-1", "pane-2"]);
    expect(countPanes(layout)).toBe(2);
    expect(findPane(layout, "pane-2")?.id).toBe("pane-2");
    expect(paneIndex(layout, "missing")).toBe(0);
  });

  // Verify conversions clamp only at the backend boundary and round to integers.
  it("converts and clamps ratios", () => {
    expect(clampRatioBasisPoints(999)).toBe(1000);
    expect(clampRatioBasisPoints(9001)).toBe(9000);
    expect(ratioToPercent(3750)).toBe(37.5);
    expect(percentToRatioBasisPoints(37.555)).toBe(3756);
  });

  // Verify insertion anchors are calculated after removing the moved tab.
  it("resolves move anchors", () => {
    const ids = ["a", "b", "c"];
    expect(resolveMoveBeforeTabId(ids, "c", 0)).toBe("a");
    expect(resolveMoveBeforeTabId(ids, "a", 2)).toBeNull();
    expect(resolveMoveBeforeTabId(ids, "b", 1)).toBe("c");
  });
});
