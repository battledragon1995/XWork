import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import { getFileEntryPaths, listFileChildren, revealFileEntry, searchFileTree } from "./files";
import { IpcCallError } from "./ipc-error";

// Replace native IPC with an isolated command recorder.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Clear command history between independent contracts.
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
// Verify both null root cursors and opaque continuation tokens are forwarded unchanged.
it.each([null, "opaque/cursor=="])("lists with cursor %s", async (cursor) => {
  const request = { projectId: "project", directory: "", cursor };
  const page = { entries: [] };
  vi.mocked(invoke).mockResolvedValue(page);
  expect(await listFileChildren(request)).toBe(page);
  expect(invoke).toHaveBeenCalledWith("list_file_children", { request });
});
// Verify recursive search uses the generated request envelope.
it("searches the project", async () => {
  const request = { projectId: "project", query: "file" };
  await searchFileTree(request);
  expect(invoke).toHaveBeenCalledWith("search_file_tree", { request });
});
// Verify fresh paths and Rust unit results are passed through without adaptation.
it("resolves paths and reveals with the same entry identity", async () => {
  const request = { projectId: "project", relativePath: "src/a.ts" };
  const paths = { relativePath: "src/a.ts", absolutePath: "X:/fixture/src/a.ts" };
  vi.mocked(invoke).mockResolvedValueOnce(paths).mockResolvedValueOnce(undefined);
  expect(await getFileEntryPaths(request)).toBe(paths);
  expect(await revealFileEntry(request)).toBeUndefined();
  expect(invoke).toHaveBeenNthCalledWith(1, "get_file_entry_paths", { request });
  expect(invoke).toHaveBeenNthCalledWith(2, "reveal_file_entry", { request });
});
// Preserve snake_case public error fields and normalize unknown transports.
it.each([
  { code: "projectNotFound", project_id: "project" },
  { code: "entryNotFound", relative_path: "gone" },
  "private native path",
])("normalizes rejection %j", async (failure) => {
  vi.mocked(invoke).mockRejectedValue(failure);
  const result = getFileEntryPaths({ projectId: "project", relativePath: "gone" });
  await expect(result).rejects.toBeInstanceOf(IpcCallError);
  await expect(result).rejects.toHaveProperty(
    "payload",
    typeof failure === "string" ? null : failure,
  );
});
