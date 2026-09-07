import { useId, useLayoutEffect, useRef, useState } from "react";
import type { FileTreeEntryDto } from "@/bindings/files/files";
import { Button } from "@/components/ui/button";
import type { FileBranchState } from "./use-file-explorer";
import { parentPath } from "./use-file-explorer";

/** Render navigable entries while keeping action and pagination buttons outside row semantics. */
export function FileTree(props: {
  branches: Map<string, FileBranchState>;
  expanded: Set<string>;
  matches: FileTreeEntryDto[] | null;
  selectedPath: string | null;
  /** Entry currently being opened, which locks activation without unmounting rows. */
  openingPath: string | null;
  disabled: boolean;
  onSelect(path: string): void;
  onToggle(path: string): void;
  onLoadMore(path: string): void;
  onRetry(path: string): void;
  onMenu(entry: FileTreeEntryDto): void;
  /** Open one file entry; selection alone never raises this. */
  onActivate(entry: FileTreeEntryDto): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const groupPrefix = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const ownsFocus = useRef(false);
  const search = props.matches !== null;
  const rows: { entry: FileTreeEntryDto; level: number }[] = [];
  // Flatten only visible loaded descendants for local keyboard navigation.
  const collect = (directory: string, level: number) => {
    for (const entry of props.branches.get(directory)?.entries ?? []) {
      rows.push({ entry, level });
      if (entry.kind === "directory" && props.expanded.has(entry.relativePath))
        collect(entry.relativePath, level + 1);
    }
  };
  if (props.matches) for (const entry of props.matches) rows.push({ entry, level: 1 });
  else collect("", 1);
  const paths = new Set(rows.map(({ entry }) => entry.relativePath));
  let target = focused;
  while (target && !paths.has(target)) target = parentPath(target);
  const tabPath = target || rows[0]?.entry.relativePath;
  // Repair only focus previously owned by a row, never steal focus from filter or menus.
  useLayoutEffect(() => {
    if (!ownsFocus.current || (focused !== null && paths.has(focused))) return;
    const node = [
      ...(container.current?.querySelectorAll<HTMLElement>("[data-file-path]") ?? []),
    ].find((item) => item.dataset.filePath === target);
    (node ?? container.current)?.focus();
  });
  /** Move focus without changing selection or scanning another directory. */
  const focus = (path: string | undefined) => {
    if (!path) return;
    setFocused(path);
    [...(container.current?.querySelectorAll<HTMLElement>("[data-file-path]") ?? [])]
      .find((item) => item.dataset.filePath === path)
      ?.focus();
  };
  /** Handle only Explorer navigation and leave IME and modified application shortcuts alone. */
  const keyDown = (event: React.KeyboardEvent, entry: FileTreeEntryDto) => {
    if (
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      props.disabled
    )
      return;
    const index = rows.findIndex((row) => row.entry.relativePath === entry.relativePath);
    const path = entry.relativePath;
    if (event.shiftKey && event.key === "F10") props.onMenu(entry);
    else if (event.key === "ArrowDown")
      focus(rows[Math.min(index + 1, rows.length - 1)]?.entry.relativePath);
    else if (event.key === "ArrowUp") focus(rows[Math.max(index - 1, 0)]?.entry.relativePath);
    else if (event.key === "Home") focus(rows[0]?.entry.relativePath);
    else if (event.key === "End") focus(rows.at(-1)?.entry.relativePath);
    else if (event.key === " " || event.key === "Enter") {
      // Space is selection only, so keyboard navigation never creates a tab by accident.
      props.onSelect(path);
      if (event.key === "Enter" && entry.kind === "directory" && !search) props.onToggle(path);
      else if (event.key === "Enter" && entry.kind === "file") props.onActivate(entry);
    } else if (!search && event.key === "ArrowRight" && entry.kind === "directory") {
      if (!props.expanded.has(path)) props.onToggle(path);
      else if (rows[index + 1]?.level > rows[index].level)
        focus(rows[index + 1]?.entry.relativePath);
    } else if (!search && event.key === "ArrowLeft") {
      if (entry.kind === "directory" && props.expanded.has(path)) props.onToggle(path);
      else focus(parentPath(path));
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  /** Build directory groups with a single roving row target. */
  const renderRows = (entries: FileTreeEntryDto[], level: number): React.ReactNode =>
    entries.map((entry) => {
      const path = entry.relativePath;
      const expanded = !search && entry.kind === "directory" ? props.expanded.has(path) : undefined;
      return (
        <div role="none" key={path}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Both dynamic roles are interactive roving targets. */}
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Both option and treeitem support the shared ARIA attributes. */}
          <div
            role={search ? "option" : "treeitem"}
            aria-label={search ? path : entry.name}
            aria-level={search ? undefined : level}
            aria-selected={props.selectedPath === path}
            aria-expanded={expanded}
            aria-owns={expanded ? `${groupPrefix}-${encodeURIComponent(path)}` : undefined}
            aria-busy={props.openingPath === path || undefined}
            aria-disabled={props.disabled}
            data-file-path={path}
            tabIndex={!props.disabled && tabPath === path ? 0 : -1}
            title={path}
            className="cursor-default truncate rounded px-2 py-1 text-[13px] outline-none hover:bg-surface-card focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-surface-card"
            style={{ paddingLeft: `${(level - 1) * 12 + 8}px` }}
            // Track row ownership separately from selection.
            onFocus={() => {
              ownsFocus.current = true;
              setFocused(path);
            }}
            // Retain ownership when a focused descendant disappears during reconciliation.
            onBlur={(event) => {
              if (event.relatedTarget)
                ownsFocus.current =
                  container.current?.contains(event.relatedTarget as Node) ?? false;
            }}
            onKeyDown={
              /** Navigate this row within the local visible projection. */ (event) =>
                keyDown(event, entry)
            }
            // Only the first click of a gesture acts: the second click of a double-click
            // carries the same intent and must not open a file twice.
            onClick={(event) => {
              if (props.disabled || event.detail > 1) return;
              props.onSelect(path);
              focus(path);
              if (expanded !== undefined) props.onToggle(path);
              else if (entry.kind === "file") props.onActivate(entry);
            }}
            onContextMenu={
              /** Select the pointer target before opening the shared menu. */ (event) => {
                event.preventDefault();
                if (!props.disabled) {
                  props.onSelect(path);
                  focus(path);
                  props.onMenu(entry);
                }
              }
            }
          >
            <span aria-hidden="true">{expanded === undefined ? "· " : expanded ? "▾ " : "▸ "}</span>
            {search ? path : entry.name}
          </div>
          {expanded && (
            // biome-ignore lint/a11y/useSemanticElements: This is an ARIA tree group, not a form fieldset.
            <div role="group" id={`${groupPrefix}-${encodeURIComponent(path)}`}>
              {renderRows(props.branches.get(path)?.entries ?? [], level + 1)}
            </div>
          )}
        </div>
      );
    });
  const selected = rows.find(({ entry }) => entry.relativePath === props.selectedPath)?.entry;
  return (
    <>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Both tree and listbox support an accessible name. */}
      <div
        ref={container}
        role={search ? "listbox" : "tree"}
        aria-label={search ? "Matching files" : "Project files"}
        aria-disabled={props.disabled}
        tabIndex={rows.length === 0 ? 0 : -1}
        className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {renderRows(props.matches ?? props.branches.get("")?.entries ?? [], 1)}
      </div>
      {selected && (
        <Button
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          onClick={
            /** Offer the same menu without letting the click reach a row underneath. */ (
              event,
            ) => {
              event.stopPropagation();
              props.onMenu(selected);
            }
          }
        >
          Actions for {selected.name}
        </Button>
      )}
      {!search &&
        [...props.branches].map(([path, branch]) => (
          <div key={path} className="px-2 text-xs text-muted">
            {branch.status === "loading" && (
              <p role="status">{path ? `Loading folder… ${path}` : "Loading files…"}</p>
            )}
            {branch.status === "ready" && !branch.entries.length && !branch.nextCursor && (
              <p>{path ? `${path}: ` : ""}No visible files in this folder.</p>
            )}
            {branch.stale && <p>Files may be out of date.</p>}
            {branch.error && <p role="alert">{branch.error}</p>}
            {branch.status === "error" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.disabled}
                onClick={/** Retry only this failed directory. */ () => props.onRetry(path)}
              >
                Retry folder {path || "root"}
              </Button>
            )}
            {branch.nextCursor && (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.disabled || branch.status === "loading"}
                onClick={/** Request one opaque continuation page. */ () => props.onLoadMore(path)}
              >
                Load more in {path || "project"}
              </Button>
            )}
          </div>
        ))}
    </>
  );
}
