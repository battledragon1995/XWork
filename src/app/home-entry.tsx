import { useCallback, useEffect, useRef, useState } from "react";
import { HomeRoute } from "@/features/home/home-route";
import { HomeNoteSections, QuickNoteComposer, useNotesPresence } from "@/features/notes";
import { useDataManagement } from "@/features/settings/data-management-provider";
import { openQuickNoteWindow } from "@/lib/ipc/quick-note-window";
import { useQuitStore } from "./quit-store";

/** Compose live maintenance and Quit state without changing provider or route identity. */
export function HomeEntry() {
  const notes = useNotesPresence();
  const { busy, invalidationEpoch, getCurrent } = useDataManagement();
  const phase = useQuitStore((state) => state.phase);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(
    /** Retire opening feedback when the route leaves. */ () => {
      mounted.current = true;
      return /** Ignore late native responses. */ () => {
        mounted.current = false;
      };
    },
    [],
  );
  /** Read the owner stores synchronously to block stale clicks and promise completions. */
  const readBoundary = useCallback(() => {
    const data = getCurrent();
    const quit = useQuitStore.getState().phase;
    return {
      epoch: data.invalidationEpoch,
      suspended: data.busy || (quit !== "idle" && quit !== "snapshot-failed"),
    };
  }, [getCurrent]);
  /** Open the singleton only within the current main operation boundary. */
  async function openCapture() {
    const before = readBoundary();
    if (openFlight.current || before.suspended || before.epoch !== invalidationEpoch) return;
    openFlight.current = true;
    setOpening(true);
    setOpenError(null);
    try {
      await openQuickNoteWindow();
    } catch {
      if (mounted.current && readBoundary().epoch === before.epoch)
        setOpenError("Could not open Quick Note. Try again.");
    } finally {
      openFlight.current = false;
      if (mounted.current) setOpening(false);
    }
  }
  return (
    <HomeRoute
      onOpenQuickNote={openCapture}
      quickNoteOpening={opening}
      quickNoteOpenError={openError}
      quickNoteSlot={
        <QuickNoteComposer
          suspended={busy || (phase !== "idle" && phase !== "snapshot-failed")}
          readSuspended={
            /** Read live admission immediately before mutations. */ () => readBoundary().suspended
          }
        />
      }
      notesSection={<HomeNoteSections />}
      notesPresence={notes.status}
      onRetryNotesPresence={notes.retry}
      boundary={{
        epoch: invalidationEpoch,
        suspended: busy || (phase !== "idle" && phase !== "snapshot-failed"),
      }}
      readBoundary={readBoundary}
    />
  );
}
