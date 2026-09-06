import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import { searchUnified } from "./search";

/** Isolate the native boundary without changing production dispatch. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Reset transport history between contracts. */
beforeEach(() => vi.resetAllMocks());
/** Forward raw Unicode and nullable context in the generated envelope. */
it.each([null, "project-id"])("forwards real search with context %s", async (contextProjectId) => {
  const response = { query: "😀 Việt", groups: [], resultCount: 0, sourceFailures: [] };
  vi.mocked(invoke).mockResolvedValue(response);
  expect(await searchUnified({ query: " 😀 Việt ", contextProjectId })).toBe(response);
  expect(invoke).toHaveBeenCalledWith("search_unified", {
    input: { query: " 😀 Việt ", contextProjectId },
  });
});
/** Preserve typed failures and discard transport diagnostics. */
it.each([
  "invalid_query",
  "invalid_context_project_id",
  "unauthorized_window",
  "unavailable",
  null,
])("normalizes %s", async (code) => {
  vi.mocked(invoke).mockRejectedValue(code ? { code } : "private data");
  await expect(searchUnified({ query: "", contextProjectId: null })).rejects.toMatchObject({
    payload: code ? { code } : null,
  });
});
