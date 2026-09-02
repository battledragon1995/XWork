import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Replace native event subscriptions for component tests that render the whole application shell.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

// jsdom implements neither ResizeObserver nor pointer capture, and the copied Radix
// primitives call both while positioning a tooltip or a menu. The stubs below keep those
// calls inert so component tests exercise behavior instead of layout measurement.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserverStub {
    // Ignore the observed element. The callback is never invoked because jsdom lays nothing out.
    observe(): void {}

    // Ignore the unobserved element.
    unobserve(): void {}

    // Ignore teardown.
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.hasPointerCapture) {
  // Report that no pointer is captured, which is always true under jsdom.
  Element.prototype.hasPointerCapture = () => false;
}

if (!Element.prototype.setPointerCapture) {
  // Accept a capture request without tracking it.
  Element.prototype.setPointerCapture = () => {};
}

if (!Element.prototype.releasePointerCapture) {
  // Accept a release request without tracking it.
  Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  // Accept a scroll request without moving anything.
  Element.prototype.scrollIntoView = () => {};
}
