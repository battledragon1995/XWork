import { RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ShortcutCategoryDto } from "@/bindings/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shortcutParts } from "@/lib/utils/keyboard-shortcuts";
import { useKeyboardShortcuts } from "./keyboard-shortcuts-provider";
import { shortcutErrorCopy } from "./keyboard-shortcuts-state";
import { SettingsSection } from "./settings-section";
import { ShortcutRecorderDialog } from "./shortcut-recorder-dialog";
import { useQuickNoteShortcutStatus } from "./use-quick-note-shortcut-status";

const AVAILABLE = new Set([
  "quick_note.open_global",
  "search.open_command_palette",
  "tabs.create",
  "tabs.close",
  "tabs.reopen_closed",
  "panes.split_right",
  "panes.split_down",
  "panes.maximize_toggle",
  "panes.close",
]);
const CATEGORIES: Record<ShortcutCategoryDto, string> = {
  global: "Global",
  navigation: "Navigation",
  tabs: "Tabs",
  panes: "Panes",
  files: "Files",
};
/** Display and edit the retained backend catalog without introducing frontend defaults. */
export function SettingsKeyboardShortcutsRoute() {
  const state = useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelRestore = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const { refresh } = state;
  useEffect(
    // Reconfirm the catalog when this route mounts; coalesce provider reads.
    () => {
      void refresh();
    },
    [refresh],
  );
  const actions = state.snapshot?.actions ?? [];
  const globalAction = actions.find(
    // Native registration is reconciled against the committed catalog chord.
    (action) => action.actionId === "quick_note.open_global",
  );
  const globalShortcut = useQuickNoteShortcutStatus(globalAction?.currentChord ?? null);
  const editing = actions.find(
    // Resolve the current action again after each committed snapshot.
    (action) => action.actionId === editingId,
  );
  useEffect(
    // A removed action cannot be resubmitted against a stale row.
    () => {
      if (
        (editingId !== null && editing === undefined) ||
        state.error?.payload?.code === "action_not_found"
      ) {
        setEditingId(null);
        setNotice("This action is no longer available.");
        if (state.error?.payload?.code === "action_not_found") void refresh();
      }
    },
    [editingId, editing, state.error, refresh],
  );
  const ready =
    state.status === "ready" &&
    state.platform !== null &&
    state.pending === null &&
    actions.length > 0;
  const filtered = actions.filter(
    // Search labels only, without changing conflict membership.
    (action) => action.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = (Object.keys(CATEGORIES) as ShortcutCategoryDto[]).filter(
    // Put Global first while retaining every category present in the filtered catalog.
    (category) => filtered.some((action) => action.category === category),
  );
  /** Restore focus after removing a reset control or closing a recorder. */
  function restoreFocus() {
    (opener.current?.isConnected ? opener.current : search.current)?.focus();
  }
  /** Reset one row and focus its surviving chord button. */
  async function resetOne(actionId: string) {
    if (await state.resetOne(actionId)) {
      void globalShortcut.refresh();
      setNotice("Defaults restored.");
      (rows.current.get(actionId) ?? search.current)?.focus();
    }
  }
  /** Confirm restore-all across the entire catalog, independent of the query. */
  async function restoreAll() {
    if (await state.resetAll()) {
      void globalShortcut.refresh();
      setRestoreOpen(false);
      setNotice("Defaults restored.");
    }
  }
  return (
    <SettingsSection
      title="Keyboard Shortcuts"
      description="Click a shortcut to record a new one. Conflicts are flagged until you resolve them."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="relative w-60">
          <Search aria-hidden="true" className="absolute top-2 left-2.5 size-3.5 text-muted" />
          <Input
            ref={search}
            aria-label="Search actions"
            placeholder="Search actions"
            className="h-8 pl-8"
            value={query}
            onChange={
              // Keep search local to this route.
              (event) => setQuery(event.target.value)
            }
          />
        </div>
        <Button
          ref={restoreButton}
          variant="outline"
          size="sm"
          disabled={!ready}
          onClick={
            // Require a reviewable confirmation before restoring every action.
            () => setRestoreOpen(true)
          }
        >
          <RotateCcw aria-hidden="true" />
          Restore all defaults
        </Button>
      </div>
      <p role="status" aria-live="polite">
        {notice}
      </p>
      {(state.status === "idle" || state.status === "loading") && (
        <p>Loading keyboard shortcuts…</p>
      )}
      {state.status === "refreshing" && <p role="status">Refreshing…</p>}
      {state.pending !== null && (
        <p role="status">{state.pending === "set" ? "Saving…" : "Restoring…"}</p>
      )}
      {state.status === "error" && (
        <div role="alert">
          <p>Could not load keyboard shortcuts.</p>
          <Button
            variant="outline"
            onClick={
              // Let users reconcile a failed load or unknown commit.
              () => void refresh()
            }
          >
            Try again
          </Button>
        </div>
      )}
      {state.error !== null && editingId === null && (
        <p role="alert">{shortcutErrorCopy(state.error, state.platform)}</p>
      )}
      {state.status === "ready" && actions.length === 0 && (
        <div>
          <p>No keyboard shortcuts are available.</p>
          <Button
            onClick={
              // Retry an anomalous empty catalog without inventing defaults.
              () => void refresh()
            }
          >
            Try again
          </Button>
        </div>
      )}
      {actions.length > 0 && filtered.length === 0 && (
        <div>
          <p>No actions found. Try another search.</p>
          <Button
            variant="outline"
            onClick={
              // Restore the full catalog without IPC.
              () => setQuery("")
            }
          >
            Clear search
          </Button>
        </div>
      )}
      {groups.length > 0 && (
        <table aria-label="Keyboard shortcuts" className="w-full table-fixed text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-[11px] font-medium tracking-wide text-muted uppercase">
              <th className="w-[40%] px-2 py-2 font-medium" scope="col">
                Action
              </th>
              <th className="w-[32%] px-2 py-2 font-medium" scope="col">
                Shortcut
              </th>
              <th className="px-2 py-2 font-medium" scope="col">
                Status
              </th>
            </tr>
          </thead>
          {groups.map(
            // Keep backend row order inside each wireframe category.
            (category) => (
              <tbody key={category} aria-label={CATEGORIES[category]}>
                <tr>
                  <th
                    colSpan={3}
                    scope="rowgroup"
                    className="px-2 pt-4 pb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase"
                  >
                    {CATEGORIES[category]}
                  </th>
                </tr>
                {filtered
                  .filter(
                    // Select only this category without reordering rows.
                    (action) => action.category === category,
                  )
                  .map(
                    // Show conflict names from the unfiltered committed snapshot.
                    (action) => (
                      <tr
                        key={action.actionId}
                        className={
                          action.conflictsWith.length > 0
                            ? "border-b border-hairline-soft bg-warning/10"
                            : "border-b border-hairline-soft"
                        }
                      >
                        <td
                          className={`px-2 py-1.5 align-middle break-words ${AVAILABLE.has(action.actionId) ? "text-body-strong" : "text-muted"}`}
                        >
                          {action.label}
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <button
                            type="button"
                            ref={
                              // Retain durable row controls for reset focus restoration.
                              (node) => {
                                if (node === null) rows.current.delete(action.actionId);
                                else rows.current.set(action.actionId, node);
                              }
                            }
                            disabled={!ready}
                            aria-label={`Change shortcut for ${action.label}`}
                            className="flex flex-wrap gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            onClick={
                              // Open a fresh draft without sending any mutation.
                              (event) => {
                                opener.current = event.currentTarget;
                                setEditingId(action.actionId);
                              }
                            }
                          >
                            {state.platform !== null &&
                              shortcutParts(action.currentChord, state.platform).map(
                                // Render physical-key display tokens as individual keycaps.
                                (part, index) => (
                                  <kbd
                                    key={part}
                                    aria-label={
                                      shortcutParts(
                                        action.currentChord,
                                        state.platform ?? "windows",
                                        true,
                                      )[index]
                                    }
                                    className="rounded border border-hairline bg-canvas px-1.5 py-0.5 font-mono text-[11px]"
                                  >
                                    {part}
                                  </kbd>
                                ),
                              )}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 align-middle text-[11px] break-words text-muted">
                          {action.actionId === "quick_note.open_global" && (
                            <div className="mb-0.5">
                              <p role={globalShortcut.error === null ? "status" : "alert"}>
                                {globalShortcut.error ??
                                  (globalShortcut.status === "active"
                                    ? "Global shortcut active"
                                    : globalShortcut.status === "disabled_by_conflict"
                                      ? "Disabled by shortcut conflict"
                                      : globalShortcut.status === "unavailable"
                                        ? "Global shortcut unavailable. Change or reset the shortcut, or restart XWork."
                                        : "Applying global shortcut…")}
                              </p>
                              {(globalShortcut.error !== null ||
                                globalShortcut.status === "unavailable") && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label="Retry global shortcut status"
                                  onClick={
                                    // Read native status again without changing the saved assignment.
                                    () => void globalShortcut.refresh()
                                  }
                                >
                                  Retry
                                </Button>
                              )}
                            </div>
                          )}
                          {action.isCustom ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!ready}
                              aria-label={`Reset shortcut for ${action.label}`}
                              onClick={
                                // Reset only this action through the serialized coordinator.
                                () => void resetOne(action.actionId)
                              }
                            >
                              Reset
                            </Button>
                          ) : (
                            "Default"
                          )}
                          {!AVAILABLE.has(action.actionId) && (
                            <span
                              className="ml-2"
                              title="You can customize this shortcut now. Its action is not available in this version."
                            >
                              Not available yet
                            </span>
                          )}
                          {action.conflictsWith.length > 0 && (
                            <p className="mt-2">
                              ⚠ Conflicts with{" "}
                              {actions
                                .filter(
                                  // Include conflicting actions hidden by the current search.
                                  (other) => action.conflictsWith.includes(other.actionId),
                                )
                                .map(
                                  // Use backend labels instead of opaque IDs.
                                  (other) => other.label,
                                )
                                .join(", ")}
                              . These shortcuts are inactive until the conflict is resolved.
                            </p>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
              </tbody>
            ),
          )}
        </table>
      )}
      {editing !== undefined && (
        <ShortcutRecorderDialog
          key={editing.actionId}
          action={editing}
          onClose={
            // Discard only the local candidate.
            () => setEditingId(null)
          }
          onSaved={
            // Announce the acknowledged backend commit.
            () => {
              void globalShortcut.refresh();
              setEditingId(null);
              setNotice("Shortcut saved.");
            }
          }
          onClosed={restoreFocus}
        />
      )}
      <Dialog
        open={restoreOpen}
        onOpenChange={
          // Do not close while restore is pending.
          (open) => {
            if (state.pending === null) setRestoreOpen(open);
          }
        }
      >
        <DialogContent
          showCloseButton={false}
          onInteractOutside={
            // Outside clicks do not confirm or cancel restoration.
            (event) => event.preventDefault()
          }
          onEscapeKeyDown={
            // Prevent dismissal during a backend write.
            (event) => {
              if (state.pending !== null) event.preventDefault();
            }
          }
          onOpenAutoFocus={
            // Default keyboard focus to the non-destructive option.
            (event) => {
              event.preventDefault();
              cancelRestore.current?.focus();
            }
          }
          onCloseAutoFocus={
            // Return to the toolbar after confirmation closes.
            (event) => {
              event.preventDefault();
              restoreButton.current?.focus();
            }
          }
        >
          <DialogTitle>Restore all keyboard shortcuts?</DialogTitle>
          <DialogDescription>
            All custom keyboard shortcuts will return to their defaults.
          </DialogDescription>
          {state.error !== null && (
            <p role="alert">{shortcutErrorCopy(state.error, state.platform)}</p>
          )}
          {state.status === "error" && (
            <Button
              onClick={
                // Recover without repeating the uncertain restoration.
                () => void refresh()
              }
            >
              Try again
            </Button>
          )}
          <DialogFooter>
            <Button
              ref={cancelRestore}
              variant="outline"
              disabled={state.pending !== null}
              onClick={
                // Cancel leaves every assignment untouched.
                () => setRestoreOpen(false)
              }
            >
              Cancel
            </Button>
            <Button
              disabled={!ready}
              onClick={
                // Restore the complete backend catalog after confirmation.
                () => void restoreAll()
              }
            >
              {state.pending === "resetAll" ? "Restoring…" : "Restore all defaults"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
