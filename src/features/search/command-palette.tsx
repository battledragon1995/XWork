import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchTargetDto } from "@/bindings/search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { searchErrorCopy, sourceFailureCopy } from "./search-error-copy";
import { SearchResultRow, type SearchTargetAvailability } from "./search-result-row";
import { useUnifiedSearch } from "./use-unified-search";

/** Render a controlled search surface without owning application navigation. */
export function CommandPalette(props: {
  open: boolean;
  contextProjectId: string | null;
  contextReady: boolean;
  platform: "windows" | "macos" | null;
  refreshKey: number;
  busy: boolean;
  executionError: string | null;
  onClose(): void;
  onClosed(): void;
  getTargetAvailability(target: SearchTargetDto): SearchTargetAvailability;
  onActivate(target: SearchTargetDto): Promise<void>;
}) {
  const search = useUnifiedSearch(props);
  const input = useRef<HTMLInputElement>(null);
  const composition = useRef(false);
  const flight = useRef(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    response: typeof search.response;
    key: string;
  } | null>(null);
  const listId = useId();
  const rows =
    search.response?.groups.flatMap(
      // Preserve the exact backend group and result order.
      (group) => group.results,
    ) ?? [];
  const active =
    (selection?.response === search.response
      ? rows.find(
          // Selection belongs only to the snapshot on which it was made.
          (row) => row.key === selection?.key,
        )
      : null) ?? rows[0];
  const busy = props.busy || localBusy;
  /** Keep IDs stable across rerenders without trusting key characters as CSS selectors. */
  function optionId(key: string) {
    return `${listId}-${encodeURIComponent(key)}`;
  }
  const activeId = active ? optionId(active.key) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  useEffect(() => {
    if (!props.open) {
      composition.current = false;
      setCallbackError(null);
    }
  }, [props.open]);
  /** Guard pointer and keyboard dispatch synchronously, including rejected owner callbacks. */
  async function activate(target: SearchTargetDto) {
    if (
      flight.current ||
      busy ||
      search.status !== "ready" ||
      !props.getTargetAvailability(target).enabled
    )
      return;
    flight.current = true;
    setLocalBusy(true);
    setCallbackError(null);
    try {
      await props.onActivate(target);
    } catch {
      setCallbackError("Could not open this result. Try again.");
    } finally {
      flight.current = false;
      setLocalBusy(false);
    }
  }
  /** Navigate every option, including unavailable commands, with input-held focus. */
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      event.nativeEvent.isComposing ||
      composition.current ||
      event.keyCode === 229 ||
      event.repeat
    )
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length || busy) return;
      const index = active ? rows.indexOf(active) : -1;
      const next = rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
      if (next) setSelection({ response: search.response, key: next.key });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && active)
        void activate(active.target);
    }
  }
  const partial = (search.response?.sourceFailures.length ?? 0) > 0;
  const error = props.executionError ?? callbackError;
  return (
    <Dialog
      open={props.open}
      // Delegate explicit dismissals to the lifetime owner.
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[12vh] flex max-h-[70vh] w-[calc(100%-2rem)] max-w-[640px] -translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]"
        // Focus the combobox rather than a mutable result.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        // The app restores focus only after this modal scope has released it.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClosed();
        }}
        // Escape belongs to IME until composition commits.
        onEscapeKeyDown={(event) => {
          if (composition.current || event.isComposing || event.keyCode === 229)
            event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Search or run a command</DialogTitle>
        <div className="flex items-center gap-2 border-b border-hairline p-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <Input
            ref={input}
            role="combobox"
            aria-label="Search or run a command"
            aria-expanded={props.open}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            value={search.query}
            onKeyDown={onKeyDown}
            // Forward the complete Unicode input without client-side truncation.
            onChange={(event) => search.setQuery(event.target.value)}
            // Keep the native composition flag synchronous for Escape/Enter.
            onCompositionStart={() => {
              composition.current = true;
              search.setComposing(true);
            }}
            // Request only the final committed IME value.
            onCompositionEnd={(event) => {
              composition.current = false;
              search.setQuery(event.currentTarget.value);
              search.setComposing(false);
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Close search" onClick={props.onClose}>
                <X aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close search (Esc)</TooltipContent>
          </Tooltip>
        </div>
        <div
          className="min-h-0 overflow-y-auto p-2"
          aria-busy={search.status === "loading" || busy}
        >
          {search.error && (
            <p role="alert" className="p-3 text-sm">
              {searchErrorCopy(search.error)}
            </p>
          )}
          {error && (
            <p role="alert" className="p-3 text-sm">
              {error}
            </p>
          )}
          {partial && (
            <div className="p-3 text-sm">
              <p>
                {search.response?.resultCount
                  ? "Some results are unavailable."
                  : "Search could not load all sources."}
              </p>
              {search.response?.sourceFailures.map(
                // Use source identities rather than diagnostic payloads.
                (failure) => (
                  <p key={failure.source}>{sourceFailureCopy(failure)}</p>
                ),
              )}
            </div>
          )}
          {(partial || search.error) && search.error?.payload?.code !== "unauthorized_window" && (
            <Button variant="outline" onClick={search.retry}>
              Try again
            </Button>
          )}
          {search.response?.resultCount === 0 && !partial && (
            <div className="p-3 text-sm">
              <p>No results found. Try another search.</p>
              <Button
                variant="ghost"
                // Clear the query through the same invalidation path as typing.
                onClick={() => search.setQuery("")}
              >
                Clear search
              </Button>
            </div>
          )}
          <div role="listbox" id={listId} aria-label="Search results">
            {search.response?.groups.map(
              // Keep backend labels, counts and cap notices intact.
              (group) => (
                <fieldset aria-label={group.label} key={group.kind}>
                  <div className="px-3 py-2 text-xs text-muted">{group.label}</div>
                  {group.results.map(
                    // Inject app availability without filtering capped catalog rows.
                    (result) => (
                      <SearchResultRow
                        key={result.key}
                        result={result}
                        id={optionId(result.key)}
                        selected={active?.key === result.key}
                        availability={props.getTargetAvailability(result.target)}
                        platform={props.platform}
                        onSelect={() =>
                          setSelection({ response: search.response, key: result.key })
                        }
                        onActivate={() => {
                          void activate(result.target);
                        }}
                      />
                    ),
                  )}
                  {group.hasMore && (
                    <p className="px-3 py-2 text-xs text-muted">
                      More matches available. Refine your search.
                    </p>
                  )}
                </fieldset>
              ),
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-hairline px-4 py-2 text-xs text-muted">
          <span>↑ ↓ move</span>
          {active && !busy && props.getTargetAvailability(active.target).enabled && (
            <span>{active.kind === "command" ? "Enter run" : "Enter open"}</span>
          )}
          <span role="status" aria-live="polite" className="ml-auto">
            {search.status === "loading"
              ? "Searching…"
              : busy
                ? active?.kind === "command"
                  ? "Running…"
                  : "Opening…"
                : search.response
                  ? `${search.response.resultCount} results`
                  : null}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
