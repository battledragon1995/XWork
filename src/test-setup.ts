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

/**
 * jsdom implements no media queries at all, so every component that resolves the operating
 * system colour scheme would throw. The stub below keeps one controllable list per live
 * subscription so a test can flip the preference and observe listener cleanup.
 */
class MediaQueryListStub extends EventTarget {
  readonly media: string;
  matches: boolean;
  changeListenerCount = 0;

  // Build one list for the given query with the preference recorded for it so far.
  constructor(media: string, matches: boolean) {
    super();
    this.media = media;
    this.matches = matches;
  }

  // Count `change` subscriptions so a test can prove the exact listener was removed.
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === "change") {
      this.changeListenerCount += 1;
    }
    super.addEventListener(type, listener, options);
  }

  // Mirror the subscription count when a listener is removed.
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === "change") {
      this.changeListenerCount = Math.max(0, this.changeListenerCount - 1);
    }
    super.removeEventListener(type, listener, options);
  }

  // Accept the deprecated Safari API without tracking it; no production code uses it.
  addListener(): void {}

  // Accept the deprecated Safari removal API without tracking it.
  removeListener(): void {}
}

/** Every list handed out since the last reset, so preference changes reach live subscribers. */
const openMediaQueryLists = new Set<MediaQueryListStub>();

/** Preference currently reported for each query string. */
const mediaQueryMatches = new Map<string, boolean>();

/** Install the stub so `window.matchMedia` exists for every jsdom test by default. */
export function installMatchMediaStub(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const list = new MediaQueryListStub(query, mediaQueryMatches.get(query) ?? false);
      openMediaQueryLists.add(list);
      return list as unknown as MediaQueryList;
    },
  });
}

/** Set the reported preference for one query and notify every live subscriber. */
export function setMediaQueryMatches(query: string, matches: boolean): void {
  mediaQueryMatches.set(query, matches);
  for (const list of openMediaQueryLists) {
    if (list.media === query) {
      list.matches = matches;
      list.dispatchEvent(new Event("change"));
    }
  }
}

/** Report how many `change` listeners are currently attached to one query. */
export function mediaQueryListenerCount(query: string): number {
  let total = 0;
  for (const list of openMediaQueryLists) {
    if (list.media === query) {
      total += list.changeListenerCount;
    }
  }
  return total;
}

/** Forget every recorded preference and subscriber so cases cannot inherit each other. */
export function resetMatchMediaStub(): void {
  openMediaQueryLists.clear();
  mediaQueryMatches.clear();
  installMatchMediaStub();
}

installMatchMediaStub();
