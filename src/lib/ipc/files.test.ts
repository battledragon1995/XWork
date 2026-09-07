import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import type { FileHandleChangedEventDto } from "@/bindings/files/files";
import {
  getFileEntryPaths,
  getOpenFile,
  listFileChildren,
  onFileHandleChanged,
  openFileInPane,
  openFileWithDefaultApp,
  reloadOpenFile,
  revealFileEntry,
  searchFileTree,
} from "./files";
import { IpcCallError } from "./ipc-error";

// Replace native IPC with an isolated command recorder.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Replace the native event boundary so no subscription reaches a real window.
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
// Clear command history between independent contracts.
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
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

// Verify the attach command forwards the generated request envelope and returns its result.
it("opens one file in a prepared pane", async () => {
  const request = {
    sessionId: "session",
    tabId: "tab",
    paneId: "pane",
    relativePath: "src/main.rs",
  };
  const result = { file: { id: "handle" }, warnings: ["recentFileNotRecorded"] };
  vi.mocked(invoke).mockResolvedValue(result);

  expect(await openFileInPane(request)).toBe(result);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("open_file_in_pane", { request });
});
// Verify both handle read commands share one request envelope and return snapshots untouched.
it.each([
  { call: getOpenFile, command: "get_open_file" },
  { call: reloadOpenFile, command: "reload_open_file" },
])("reads a handle through $command", async ({ call, command }) => {
  const request = { fileHandleId: "handle" };
  const handle = { id: "handle", revision: "7" };
  vi.mocked(invoke).mockResolvedValue(handle);

  expect(await call(request)).toBe(handle);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { request });
});
// Verify the Rust unit result is passed through as an undefined resolution.
it("opens a handle with the default application", async () => {
  const request = { fileHandleId: "handle" };
  vi.mocked(invoke).mockResolvedValue(undefined);

  expect(await openFileWithDefaultApp(request)).toBeUndefined();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("open_file_with_default_app", { request });
});
// Preserve tagged handle errors and normalize an unknown transport failure identically.
it.each([
  { code: "fileHandleNotFound", file_handle_id: "handle" },
  { code: "windowNotAllowed" },
  "native failure text",
])("normalizes a handle rejection %j", async (failure) => {
  vi.mocked(invoke).mockRejectedValue(failure);

  const result = getOpenFile({ fileHandleId: "handle" });
  await expect(result).rejects.toBeInstanceOf(IpcCallError);
  await expect(result).rejects.toHaveProperty(
    "payload",
    typeof failure === "string" ? null : failure,
  );
});
// Verify the handle subscription forwards payloads and returns its own unlisten function.
it("forwards handle invalidations and returns the unlisten handle", async () => {
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);
  const listener = vi.fn();
  const payload: FileHandleChangedEventDto = {
    fileHandleId: "handle",
    revision: "9007199254740993",
    change: "reloaded",
  };

  const returned = await onFileHandleChanged(listener);

  expect(vi.mocked(listen).mock.calls[0]?.[0]).toBe("files://handle-changed");
  expect(returned).toBe(unlisten);

  const forward = vi.mocked(listen).mock.calls[0]?.[1] as (event: {
    payload: FileHandleChangedEventDto;
  }) => void;
  forward({ payload });

  expect(listener).toHaveBeenCalledExactlyOnceWith(payload);
});
// Verify a refused registration reaches the caller instead of being swallowed in the adapter.
it("propagates a failed handle subscription", async () => {
  vi.mocked(listen).mockRejectedValue(new Error("registration refused"));

  await expect(onFileHandleChanged(vi.fn())).rejects.toThrow("registration refused");
});
