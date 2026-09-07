import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FileEntryPathsDto,
  FileEntryRequestDto,
  FileHandleChangedEventDto,
  FileHandleDto,
  FileHandleRequestDto,
  FilesError,
  FileTreePageDto,
  FileTreeSearchDto,
  ListFileChildrenRequestDto,
  OpenFileInPaneRequestDto,
  OpenFileResultDto,
  SearchFileTreeRequestDto,
} from "@/bindings/files/files";
import { invokeCommand } from "./ipc-error";

/** Handle invalidation event emitted by BE-014 after a committed state change. */
const FILE_HANDLE_CHANGED_EVENT = "files://handle-changed";

/** Read one page of visible direct children. */
export function listFileChildren(request: ListFileChildrenRequestDto): Promise<FileTreePageDto> {
  return invokeCommand<FileTreePageDto, FilesError>("list_file_children", { request });
}
/** Search visible basenames across the registered project. */
export function searchFileTree(request: SearchFileTreeRequestDto): Promise<FileTreeSearchDto> {
  return invokeCommand<FileTreeSearchDto, FilesError>("search_file_tree", { request });
}
/** Resolve freshly validated copyable paths. */
export function getFileEntryPaths(request: FileEntryRequestDto): Promise<FileEntryPathsDto> {
  return invokeCommand<FileEntryPathsDto, FilesError>("get_file_entry_paths", { request });
}
/** Reveal a validated entry through the backend. */
export function revealFileEntry(request: FileEntryRequestDto): Promise<void> {
  return invokeCommand<void, FilesError>("reveal_file_entry", { request });
}

/** Attach one project-relative file to a pane the session runtime already prepared. */
export function openFileInPane(request: OpenFileInPaneRequestDto): Promise<OpenFileResultDto> {
  return invokeCommand<OpenFileResultDto, FilesError>("open_file_in_pane", { request });
}
/** Read the current authoritative snapshot of one open handle from backend memory. */
export function getOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto> {
  return invokeCommand<FileHandleDto, FilesError>("get_open_file", { request });
}
/** Ask the backend to re-read one open handle from disk. */
export function reloadOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto> {
  return invokeCommand<FileHandleDto, FilesError>("reload_open_file", { request });
}
/** Ask the operating system to open one handle with its default application. */
export function openFileWithDefaultApp(request: FileHandleRequestDto): Promise<void> {
  return invokeCommand<void, FilesError>("open_file_with_default_app", { request });
}
/**
 * Subscribe to handle invalidations. The payload carries no content, so subscribers must
 * re-read the snapshot instead of patching state from the event itself.
 */
export function onFileHandleChanged(
  listener: (event: FileHandleChangedEventDto) => void,
): Promise<UnlistenFn> {
  return listen<FileHandleChangedEventDto>(
    FILE_HANDLE_CHANGED_EVENT,
    (event: Event<FileHandleChangedEventDto>) => {
      listener(event.payload);
    },
  );
}
