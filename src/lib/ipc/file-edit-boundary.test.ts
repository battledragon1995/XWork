import { expect, it, vi } from "vitest";
import { createFileEditBoundary, type FileEditCallbacks } from "./file-edit-boundary";

/** Build fresh callback-only state for each test. */
function callbacks(): FileEditCallbacks {
  return {
    settle: vi.fn(async () => () => undefined),
    save: vi.fn(async () => undefined),
    hasPendingEdits: () => true,
    subscribe: () => () => undefined,
  };
}
// Late provider cleanup must never detach a replacement provider.
it("ignores stale unregister and keeps projections live", async () => {
  const bridge = createFileEditBoundary();
  const first = callbacks();
  const second = callbacks();
  const removeFirst = bridge.register(first);
  const removeSecond = bridge.register(second);
  removeFirst();
  await bridge.settle({ kind: "all" });
  expect(second.settle).toHaveBeenCalledOnce();
  expect(first.settle).not.toHaveBeenCalled();
  removeSecond();
  expect(bridge.hasPendingEdits({ kind: "all" })).toBe(false);
});
// Producer rejection must remain observable by destructive wrapper owners.
it("propagates settlement failure without substituting a clean state", async () => {
  const bridge = createFileEditBoundary();
  const producer = callbacks();
  producer.settle = vi.fn(async () => {
    throw new Error("pending draft");
  });
  bridge.register(producer);
  await expect(bridge.settle({ kind: "all" })).rejects.toThrow("pending draft");
});
