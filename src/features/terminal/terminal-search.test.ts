import { expect, it, vi } from "vitest";
import { findPlainWebLinks, findTerminalMatches } from "./terminal-search";

/** Verifies history rows outside mounted DOM and row boundaries are searched independently. */
it("finds retained Unicode rows without crossing visual-row boundaries", async () => {
  const rows = ["first 🙂 café", "outside DOM", "split", "match"];
  expect(await findTerminalMatches(rows, "outside")).toEqual([{ row: 1, column: 0, length: 7 }]);
  expect(await findTerminalMatches(rows, "OUTSIDE")).toEqual([]);
  expect(await findTerminalMatches(rows, "splitmatch")).toEqual([]);
  expect(await findTerminalMatches(rows, "🙂")).toEqual([{ row: 0, column: 6, length: 2 }]);
});

/** Verifies a changed query cancels a yielded long-running scan. */
it("cancels a stale search generation after yielding", async () => {
  let current = true;
  const yieldNow = vi.fn(async () => {
    current = false;
  });
  const matches = await findTerminalMatches(
    Array.from({ length: 300 }, () => "needle"),
    "needle",
    () => current,
    yieldNow,
  );
  expect(matches).toEqual([]);
  expect(yieldNow).toHaveBeenCalled();
});

/** Verifies plain links keep balanced delimiters and drop prose punctuation. */
it("extracts only explicit HTTP links with safe trailing punctuation", () => {
  expect(
    findPlainWebLinks("See https://example.com/a_(b). Then http://localhost:3000/x!, file:///x"),
  ).toEqual(["https://example.com/a_(b)", "http://localhost:3000/x"]);
});
