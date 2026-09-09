import { useCallback, useEffect, useRef, useState } from "react";
import type { ShortcutChordDto } from "@/bindings/keyboard-shortcuts";
import type { QuickNoteGlobalShortcutStatusDto } from "@/bindings/quick-note-window";
import {
  getQuickNoteGlobalShortcutStatus,
  onQuickNoteGlobalShortcutStatusChanged,
} from "@/lib/ipc/quick-note-window";

const STATUS_ERROR = "Could not read global shortcut status. Try again.";

/** Reconcile native registration independently of the saved shortcut catalog. */
export function useQuickNoteShortcutStatus(chord: ShortcutChordDto | null) {
  const [snapshot, setSnapshot] = useState<QuickNoteGlobalShortcutStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(
    // Expose a stable refresh that always targets the current effect lifetime.
    async () => {
      await refreshRef.current?.();
    },
    [],
  );

  useEffect(
    // Subscribe before reading so an intervening native update cannot be lost.
    () => {
      let alive = true;
      let latest: bigint | null = null;
      let revision = 0;
      let unlisten: (() => void) | null = null;
      let subscription: Promise<void> | null = null;

      /** Accept only newer decimal sequences without numeric precision loss. */
      function accept(next: QuickNoteGlobalShortcutStatusDto) {
        if (!alive || !/^\d+$/.test(next.sequence) || next.actionId !== "quick_note.open_global") {
          return;
        }
        const sequence = BigInt(next.sequence);
        if (latest !== null && sequence <= latest) return;
        latest = sequence;
        revision += 1;
        setSnapshot(next);
        setError(null);
      }

      /** Share pending registration and release subscriptions resolved after unmount. */
      async function subscribe() {
        if (unlisten !== null) return;
        if (subscription === null) {
          subscription = onQuickNoteGlobalShortcutStatusChanged(accept).then(
            // A late native listener must never outlive its owning route.
            (stop) => {
              if (alive) unlisten = stop;
              else stop();
            },
          );
        }
        try {
          await subscription;
        } finally {
          subscription = null;
        }
      }

      /** Retry subscription and query without replacing a newer event with a failed read. */
      async function read() {
        const startedRevision = revision;
        try {
          await subscribe();
          if (!alive) return;
          const next = await getQuickNoteGlobalShortcutStatus();
          if (!alive) return;
          if (!/^\d+$/.test(next.sequence) || next.actionId !== "quick_note.open_global") {
            if (revision === startedRevision) setError(STATUS_ERROR);
            return;
          }
          accept(next);
          if (latest !== null && BigInt(next.sequence) === latest) setError(null);
        } catch {
          if (alive && revision === startedRevision) setError(STATUS_ERROR);
        }
      }

      /** Reconcile registration when the main window regains focus. */
      function onFocus() {
        void read();
      }
      refreshRef.current = read;
      void read();
      window.addEventListener("focus", onFocus);
      return () => {
        // Invalidate pending reads and release both DOM and native listeners.
        alive = false;
        refreshRef.current = null;
        window.removeEventListener("focus", onFocus);
        unlisten?.();
      };
    },
    [],
  );

  const matches =
    chord !== null &&
    snapshot !== null &&
    chord.primary === snapshot.chord.primary &&
    chord.alt === snapshot.chord.alt &&
    chord.shift === snapshot.chord.shift &&
    chord.keyCode === snapshot.chord.keyCode;
  return {
    status: error !== null ? "unknown" : !matches ? "pending" : snapshot.state,
    error,
    refresh,
  } as const;
}
