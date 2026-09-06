import type {
  FileEntryPathsDto,
  FileEntryRequestDto,
  FilesError,
  FileTreePageDto,
  FileTreeSearchDto,
  ListFileChildrenRequestDto,
  SearchFileTreeRequestDto,
} from "@/bindings/files/files";
import { invokeCommand } from "./ipc-error";

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
