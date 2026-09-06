import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SearchResultDto } from "@/bindings/search";
import { SearchResultRow } from "./search-result-row";

/** Release each independent row. */
afterEach(cleanup);
/** Render a generated row with minimal callbacks. */
function renderRow(
  patch: Partial<SearchResultDto> = {},
  platform: "windows" | "macos" | null = "windows",
) {
  const result: SearchResultDto = {
    key: "p",
    kind: "project",
    title: "😀 Việt <script>",
    context: "C:\\Việt",
    titleHighlights: [
      { startScalar: 0, endScalar: 1 },
      { startScalar: 2, endScalar: 6 },
    ],
    contextHighlights: [{ startScalar: 3, endScalar: 7 }],
    target: { kind: "project", projectId: "p" },
    shortcut: null,
    supportsOpenInSplit: false,
    ...patch,
  };
  return render(
    <SearchResultRow
      result={result}
      id="result"
      selected
      availability={{ enabled: false, reason: "Not available yet." }}
      platform={platform}
      onSelect={vi.fn()}
      onActivate={vi.fn()}
    />,
  );
}
/** Scalar slices preserve emoji/Vietnamese and never interpret markup. */
it("highlights Unicode scalars as safe text", () => {
  const { container } = renderRow();
  expect(Array.from(container.querySelectorAll("mark"), (node) => node.textContent)).toEqual([
    "😀",
    "Việt",
    "Việt",
  ]);
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByRole("option")).toHaveTextContent("<script>");
  expect(screen.getByRole("option")).toHaveAttribute("aria-disabled", "true");
});
/** Conflicted accelerators are labelled and unknown platforms show no keycap. */
it.each(["windows", "macos", null] as const)("formats shortcuts for %s", (platform) => {
  const { container } = renderRow(
    {
      context: null,
      shortcut: { primary: true, alt: false, shift: false, keyCode: "KeyK", isConflicted: true },
    },
    platform,
  );
  if (platform) {
    expect(container.querySelector("kbd")).toHaveTextContent(
      platform === "windows" ? "Ctrl K" : "Command K",
    );
    expect(screen.getByText("Shortcut conflict")).toBeInTheDocument();
  } else expect(container.querySelector("kbd")).toBeNull();
});
