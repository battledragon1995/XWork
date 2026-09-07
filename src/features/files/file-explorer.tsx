import { ChevronsDownUp, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileTreeEntryDto, FileTreePageDto, FileTreeSearchDto } from "@/bindings/files/files";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  openingFileCopy,
  PANE_LIMIT_EXPLANATION,
  PLACEMENT_LABELS,
  truncationCopy,
  warningCopy,
} from "./file-error-copy";
import { FileTree } from "./file-tree";
import { useFileExplorer } from "./use-file-explorer";

/** Identify whether the current application generation accepts work. */
export interface FileExplorerBoundary {
  epoch: number;
  suspended: boolean;
}
/** Pane position Explorer asks its Sessions host to prepare before attaching a file. */
export type FilePlacement = "newTab" | "emptyPane" | "splitRight" | "splitDown";
/** One empty pane the host prepared for this opening. */
export interface FileTarget {
  tabId: string;
  paneId: string;
}
/** Supply only route identity and application-owned recovery callbacks. */
export interface FileExplorerProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  platform: "windows" | "macos" | null;
  boundary: FileExplorerBoundary;
  /** Which openings the host can satisfy; Explorer never inspects session layout itself. */
  placements: Record<FilePlacement, boolean>;
  /** Read live owners before dispatch and completion. */
  readBoundary(): FileExplorerBoundary;
  /** Prepare one empty pane, or answer `null` when the host refuses. */
  prepareTarget(placement: FilePlacement): Promise<FileTarget | null>;
  /** Ask the host to re-read its session snapshot after a successful attachment. */
  onFileOpened(): void;
  /** Close through the owning toggle. */
  onClose(): void;
  /** Navigate to project recovery. */
  onOpenProject(): void;
  /** Leave a removed project's route. */
  onProjectMissing(): void;
}
/** Render a bounded page's own warnings without adding repeated scan totals together. */
function Warnings(props: { page: FileTreePageDto | FileTreeSearchDto; scope: string }) {
  if (!props.page.warningCount) return null;
  return (
    <details className="break-words text-xs text-muted">
      <summary>
        Some entries could not be listed. ({props.scope}: {props.page.warningCount})
      </summary>
      <p>Latest response for {props.scope}.</p>
      <ul>
        {props.page.warnings.slice(0, 20).map((warning, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Backend warnings can repeat the same reason and directory within one immutable page.
          <li key={`${warning.relativeDirectory}:${warning.reason}:${index}`}>
            {warning.relativeDirectory || props.scope}: {warningCopy(warning.reason)}
          </li>
        ))}
      </ul>
      {props.page.warningsTruncated && <p>Additional warnings were omitted.</p>}
    </details>
  );
}
/** The four openings in the exact order FE-017 lists them above the copy group. */
const PLACEMENTS: FilePlacement[] = ["newTab", "emptyPane", "splitRight", "splitDown"];

/** Render the project Explorer, including the four ways to open one file into a pane. */
export function FileExplorer(props: FileExplorerProps): React.JSX.Element {
  const { state, owner, current } = useFileExplorer(props);
  const filter = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);
  const [menu, setMenu] = useState<{ entry: FileTreeEntryDto; generation: number } | null>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const disabled = !current || state.blocked;
  const opening = state.openingPath !== null;
  // The backend's own basename convention, so the announcement names the file being opened.
  const openingName = state.openingPath?.split("/").at(-1) ?? null;
  const canRetry = !["windowNotAllowed", "invalidProjectId", "traversalLimitExceeded"].includes(
    state.errorCode ?? "",
  );
  const searching = !!state.query.trim() && !state.validation;
  const selectedMenu =
    menu && menu.generation === state.generation && !disabled ? menu.entry : null;
  // Remember only an explicit opening, not a later maintenance-resume transition.
  useEffect(() => {
    focusOnOpen.current = props.isVisible;
  }, [props.isVisible]);
  // Initial controller activation enables the input after its first render.
  useEffect(() => {
    if (current && props.isVisible && !props.boundary.suspended && focusOnOpen.current) {
      filter.current?.focus();
      focusOnOpen.current = false;
    }
  }, [current, props.isVisible, props.boundary.suspended]);
  // Retire local menu state alongside controller snapshots and application epochs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each boundary change must release the previous menu target.
  useEffect(() => {
    setMenu(null);
  }, [state.generation, props.isVisible, props.boundary.epoch, props.boundary.suspended]);
  /** Open the same accessible menu from pointer, keyboard, or the actions control. */
  const openMenu = (entry: FileTreeEntryDto) => {
    if (!owner.current() || disabled) return;
    owner.select(entry.relativePath);
    menuReturn.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenu({ entry, generation: state.generation });
  };
  if (!props.isVisible) return <span id={props.regionId} hidden />;
  return (
    <aside
      id={props.regionId}
      aria-label="File Explorer"
      className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-auto border-hairline bg-surface px-2 py-2 text-body"
    >
      <header className="flex items-center justify-between gap-1">
        <h2 className="text-sm font-semibold">File Explorer</h2>
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh files"
                disabled={!current || !canRetry}
                onClick={owner.refresh}
              >
                <RefreshCw aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse all"
                disabled={disabled || searching}
                onClick={owner.collapseAll}
              >
                <ChevronsDownUp aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse all</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close File Explorer"
                onClick={
                  /** Close only while the live application still accepts interaction. */ () => {
                    if (owner.current()) props.onClose();
                  }
                }
              >
                <X aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close File Explorer</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <Input
        ref={filter}
        aria-label="Filter files"
        placeholder="Filter files"
        value={state.query}
        disabled={disabled}
        aria-invalid={!!state.validation}
        aria-describedby={state.validation ? `${props.regionId}-validation` : undefined}
        onChange={
          /** Retire old results as soon as the draft changes. */ (event) =>
            owner.setQuery(event.target.value)
        }
        onCompositionStart={
          /** Pause debounce while IME owns the draft. */ () => owner.setComposing(true)
        }
        onCompositionEnd={/** Schedule the committed IME text. */ () => owner.setComposing(false)}
        onKeyDown={
          /** Clear only a committed filter without capturing application keys. */ (event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing && state.query) {
              event.preventDefault();
              event.stopPropagation();
              owner.setQuery("");
            }
          }
        }
      />
      {state.validation && (
        <p id={`${props.regionId}-validation`} role="alert" className="text-xs">
          {state.validation}
        </p>
      )}
      {state.query && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={/** Restore the current tree view. */ () => owner.setQuery("")}
        >
          Clear filter
        </Button>
      )}
      <p className="truncate text-xs font-semibold" title={state.project?.displayName}>
        {state.project?.displayName}
      </p>
      <p className="text-xs text-muted">Project ignore rules applied</p>
      {(!current || (state.blocked && !state.error)) && (
        <p role="status">File Explorer is temporarily unavailable.</p>
      )}
      {state.error && (
        <div role="alert" className="break-words text-xs">
          <p>{state.error}</p>
          {canRetry && (
            <Button variant="ghost" size="sm" disabled={!current} onClick={owner.refresh}>
              Retry
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!current}
            onClick={
              /** Delegate project recovery to the existing navigation owner. */ () => {
                if (owner.current()) {
                  if (state.errorCode === "invalidProjectId") props.onProjectMissing();
                  else props.onOpenProject();
                }
              }
            }
          >
            {state.errorCode === "invalidProjectId" ? "Open projects" : "Open project"}
          </Button>
        </div>
      )}
      {current && !state.project && !state.error && <p role="status">Loading files…</p>}
      <div aria-busy={searching && state.searchStatus === "loading"}>
        {searching && state.searchStatus === "loading" && <p role="status">Searching files…</p>}
        {searching && state.searchStatus === "ready" && !state.search?.matches.length && (
          <p>No matching files.</p>
        )}
        <FileTree
          branches={state.branches}
          expanded={state.expanded}
          matches={searching ? (state.search?.matches ?? []) : null}
          selectedPath={state.selectedPath}
          openingPath={state.openingPath}
          disabled={disabled || opening}
          onSelect={owner.select}
          onToggle={owner.toggleDirectory}
          onLoadMore={owner.loadMore}
          onRetry={
            /** Retry one branch explicitly without another automatic recovery loop. */ (path) =>
              owner.list(path, null, true)
          }
          onMenu={openMenu}
          onActivate={
            /** A plain activation always opens in a new tab, per FE-017. */ (entry) =>
              void owner.open(entry, "newTab")
          }
        />
      </div>
      {searching && state.search && (
        <>
          <Warnings page={state.search} scope="Search" />
          {state.search.truncatedReason && (
            <p role="status" className="text-xs">
              {truncationCopy(state.search.truncatedReason)}
            </p>
          )}
        </>
      )}
      {!searching &&
        [...state.branches].map(
          ([path, branch]) =>
            branch.lastPage && (
              <Warnings
                key={path}
                page={branch.lastPage}
                scope={path || state.project?.displayName || "Project"}
              />
            ),
        )}
      {state.limited && (
        <p role="status" className="text-xs">
          Explorer display limit reached. Collapse folders or use Filter files.
        </p>
      )}
      <div role="status" aria-live="polite" className="text-xs">
        {state.feedback}
        {state.openFeedback}
        {openingName !== null && openingFileCopy(openingName)}
      </div>
      {state.actionError && (
        <p role="alert" className="text-xs">
          {state.actionError}
        </p>
      )}
      {state.openError && (
        <div role="alert" className="text-xs">
          <p>{state.openError}</p>
          {state.canRetryOpen && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || opening}
              onClick={owner.retryOpen}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      <DropdownMenu
        open={selectedMenu !== null}
        onOpenChange={
          /** Release the selected menu target when Radix closes the menu. */ (open) => {
            if (!open) setMenu(null);
          }
        }
      >
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" />
        </DropdownMenuTrigger>
        {selectedMenu && (
          <DropdownMenuContent
            onCloseAutoFocus={
              /** Restore the real opener only in its valid route lifetime. */ (event) => {
                event.preventDefault();
                if (owner.current() && menuReturn.current?.isConnected) menuReturn.current.focus();
              }
            }
          >
            {selectedMenu.kind === "file" &&
              PLACEMENTS.map((placement) => (
                <DropdownMenuItem
                  key={placement}
                  disabled={!props.placements[placement] || opening || state.pendingAction}
                  onSelect={
                    /** Ask the host for this exact placement, then attach once. */ () =>
                      void owner.open(selectedMenu, placement)
                  }
                >
                  {PLACEMENT_LABELS[placement]}
                </DropdownMenuItem>
              ))}
            {selectedMenu.kind === "file" &&
              !props.placements.splitRight &&
              !props.placements.splitDown && (
                <p className="px-2 text-xs text-muted">{PANE_LIMIT_EXPLANATION}</p>
              )}
            <DropdownMenuItem
              disabled={state.pendingAction}
              onSelect={
                /** Revalidate and copy the absolute path. */ () =>
                  void owner.action("copyAbsolute", selectedMenu)
              }
            >
              Copy path
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={state.pendingAction}
              onSelect={
                /** Revalidate and copy the project-relative path. */ () =>
                  void owner.action("copyRelative", selectedMenu)
              }
            >
              Copy relative path
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={state.pendingAction || selectedMenu.kind === "symbolicLink"}
              onSelect={
                /** Reveal through the narrow native wrapper exactly once. */ () =>
                  void owner.action("reveal", selectedMenu)
              }
            >
              {props.platform === "windows"
                ? "Reveal in File Explorer"
                : props.platform === "macos"
                  ? "Reveal in Finder"
                  : "Reveal in file manager"}
            </DropdownMenuItem>
            {selectedMenu.kind === "symbolicLink" && (
              <p className="px-2 text-xs text-muted">Symbolic links cannot be revealed.</p>
            )}
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </aside>
  );
}
