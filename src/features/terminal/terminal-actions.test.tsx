import { expect, it, vi } from "vitest";
import type { TerminalRegistryEntry } from "./terminal-registry";
import { pasteFromClipboard } from "./terminal-actions";

/** Creates the activation and paste surface required by the race test. */
function fakeEntry() {
  let generation = 1;
  return {
    entry: {
      activationToken: () => generation,
      isActivationCurrent: (token: number) => token === generation,
      paste: vi.fn(() => true),
    } as unknown as TerminalRegistryEntry,
    deactivate: () => {
      generation += 1;
    },
  };
}

/** Verifies a delayed clipboard reply cannot paste into a pane that lost activation. */
it("drops stale clipboard text after activation changes", async () => {
  const fixture = fakeEntry();
  let resolve!: (text: string | null) => void;
  const pending = pasteFromClipboard(
    fixture.entry,
    "terminal-1",
    () => new Promise((done) => (resolve = done)),
  );
  fixture.deactivate();
  resolve("stale");
  expect(await pending).toBe(false);
  expect(fixture.entry.paste).not.toHaveBeenCalled();
});

/** Verifies an active reply is normalized by the registry exactly once. */
it("passes one active clipboard snapshot to the retained entry", async () => {
  const fixture = fakeEntry();
  expect(await pasteFromClipboard(fixture.entry, "terminal-1", async () => "a\r\nb")).toBe(true);
  expect(fixture.entry.paste).toHaveBeenCalledWith("a\r\nb");
});
