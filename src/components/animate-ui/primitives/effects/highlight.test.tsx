import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Highlight, HighlightItem } from "./highlight";

/** Releases rendered effects and restores deterministic layout seams after each case. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Keeps the moving background aligned with its hovered row in the container's CSS coordinates. */
it.each([0.8571, 1, 1.0714, 1.1429, 1.4286])(
  "aligns hover bounds at interface scale %s",
  async (scale) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      /** Models zoomed viewport coordinates with a nonzero container origin. */
      .mockImplementation(function (this: HTMLElement) {
        const container = this.dataset.slot === "motion-highlight-container";
        const second = this.textContent === "Session";
        return {
          top: 40 + (container ? 0 : second ? 280 : 200) * scale,
          left: 15 + (container ? 0 : 32) * scale,
          width: (container ? 240 : 180) * scale,
          height: (container ? 700 : 28) * scale,
        } as DOMRect;
      });
    const { container } = render(
      <Highlight
        mode="parent"
        hover
        controlledItems
        transition={{ duration: 0 }}
        boundsOffset={{ top: 2, left: 1, width: -2, height: -4 }}
      >
        <HighlightItem asChild>
          <button type="button">Project</button>
        </HighlightItem>
        <HighlightItem asChild>
          <button type="button">Session</button>
        </HighlightItem>
      </Highlight>,
    );
    const host = container.querySelector('[data-slot="motion-highlight-container"]');
    if (host === null) throw new Error("The highlight container must be rendered.");
    Object.defineProperties(host, {
      offsetWidth: { value: 240 },
      offsetHeight: { value: 700 },
    });
    for (const [label, top] of [
      ["Project", 202],
      ["Session", 282],
    ] as const) {
      fireEvent.mouseEnter(screen.getByRole("button", { name: label }));
      // Inspect the real animated element after it settles, including movement between nested rows.
      await waitFor(() => {
        const highlight = container.querySelector<HTMLElement>('[data-slot="motion-highlight"]');
        expect(Number.parseFloat(highlight?.style.top ?? "")).toBeCloseTo(top);
        expect(Number.parseFloat(highlight?.style.left ?? "")).toBeCloseTo(33);
        expect(Number.parseFloat(highlight?.style.width ?? "")).toBeCloseTo(178);
        expect(Number.parseFloat(highlight?.style.height ?? "")).toBeCloseTo(24);
      });
    }
  },
);
