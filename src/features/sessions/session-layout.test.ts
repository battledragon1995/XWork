import { describe, expect, it } from "vitest";
import { createPaneDto, createSplitLayout } from "./sessions-test-fixture";
import {
  clampRatioBasisPoints,
  countPanes,
  findFirstEmptyPane,
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

  // Verify the empty-pane lookup follows the same first-then-second order as the renderer.
  it("finds the first empty pane across one to four panes", () => {
    const filled = createPaneDto({
      id: "pane-tool",
      content: { kind: "toolSelection", profileId: "builtin:codex", title: "Codex" },
    });

    // One pane, empty: it is its own answer.
    expect(findFirstEmptyPane({ kind: "pane", pane: createPaneDto() })?.id).toBe("pane-1");
    // One pane, occupied: no empty leaf exists at all.
    expect(findFirstEmptyPane({ kind: "pane", pane: filled })).toBeNull();
    // Two panes with the empty leaf second: order still picks the only empty one.
    expect(
      findFirstEmptyPane(
        createSplitLayout({
          first: { kind: "pane", pane: filled },
          second: { kind: "pane", pane: createPaneDto({ id: "pane-2" }) },
        }),
      )?.id,
    ).toBe("pane-2");
    // Four panes with two empty leaves: the earlier leaf in tree order wins.
    expect(
      findFirstEmptyPane(
        createSplitLayout({
          first: createSplitLayout({
            splitId: "split-2",
            first: { kind: "pane", pane: filled },
            second: { kind: "pane", pane: createPaneDto({ id: "pane-3" }) },
          }),
          second: createSplitLayout({
            splitId: "split-3",
            first: { kind: "pane", pane: createPaneDto({ id: "pane-4" }) },
            second: { kind: "pane", pane: filled },
          }),
        }),
      )?.id,
    ).toBe("pane-3");
    // A tab whose leaves are all occupied returns nothing rather than a guessed pane.
    expect(
      findFirstEmptyPane(
        createSplitLayout({
          first: { kind: "pane", pane: filled },
          second: { kind: "pane", pane: filled },
        }),
      ),
    ).toBeNull();
  });

  // Verify insertion anchors are calculated after removing the moved tab.
  it("resolves move anchors", () => {
    const ids = ["a", "b", "c"];
    expect(resolveMoveBeforeTabId(ids, "c", 0)).toBe("a");
    expect(resolveMoveBeforeTabId(ids, "a", 2)).toBeNull();
    expect(resolveMoveBeforeTabId(ids, "b", 1)).toBe("c");
  });
});
