import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { invokeCommand } from "./ipc-error";
vi.mock("@tauri-apps/api/core", /** Isolate native transport. */ () => ({ invoke: vi.fn() }));
describe("IPC error tags", /** Preserve each generated discriminator. */ () => {
  it.each([{ code: "storage_unavailable" }, { kind: "event_not_found" }])(
    "preserves %j",
    /** Keep typed owner recovery. */ async (payload) => {
      vi.mocked(invoke).mockRejectedValueOnce(payload);
      await expect(invokeCommand("read")).rejects.toMatchObject({ payload });
    },
  );
  it("rejects malformed tags", /** Hide unknown native payloads. */ async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 1 });
    await expect(invokeCommand("read")).rejects.toMatchObject({ payload: null });
  });
});
