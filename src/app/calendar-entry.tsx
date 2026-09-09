import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { CalendarRoute, EventCreateDialog, type CalendarBoundary } from "@/features/calendar";
import { useDataManagement } from "@/features/settings/data-management-provider";
import { useQuitStore } from "./quit-store";

/** Compose rendered and synchronous admission for Calendar reads and navigation. */
export function useCalendarBoundary() {
  const { busy, invalidationEpoch, getCurrent } = useDataManagement();
  const phase = useQuitStore((state) => state.phase);
  /** Reject stale callbacks before owner updates reach React. */
  const readBoundary = useCallback((): CalendarBoundary => {
    const data = getCurrent();
    const quit = useQuitStore.getState().phase;
    return {
      epoch: data.invalidationEpoch,
      suspended: data.busy || (quit !== "idle" && quit !== "snapshot-failed"),
    };
  }, [getCurrent]);
  return {
    boundary: {
      epoch: invalidationEpoch,
      suspended: busy || (phase !== "idle" && phase !== "snapshot-failed"),
    },
    readBoundary,
  };
}

/** Mount the real Calendar owner inside the persistent application boundary. */
export function CalendarEntry() {
  const { boundary, readBoundary } = useCalendarBoundary();
  const [params, setParams] = useSearchParams();
  const [intent, setIntent] = useState<{
    date: string;
    projectId: string | null;
    epoch: number;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const activeIntent = useRef<typeof intent>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(
    /** Permanently retire manual drafts when lifecycle work takes ownership. */ () => {
      if (boundary.suspended || (intent && intent.epoch !== boundary.epoch)) {
        activeIntent.current = null;
        setIntent(null);
        opener.current = null;
      }
    },
    [boundary.epoch, boundary.suspended, intent],
  );
  /** Keep create completion and focus within the original operation boundary. */
  function admitted() {
    const live = readBoundary();
    return !live.suspended && live.epoch === boundary.epoch;
  }
  return (
    <>
      <CalendarRoute
        key={refresh}
        boundary={boundary}
        readBoundary={readBoundary}
        onCreateEvent={
          /** Open one form using Calendar's validated date and project scope. */ (input) => {
            if (!admitted() || activeIntent.current) return;
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const next = new URLSearchParams(params);
            next.delete("event");
            next.set("date", input.date);
            setParams(next);
            const nextIntent = { ...input, epoch: boundary.epoch };
            activeIntent.current = nextIntent;
            setIntent(nextIntent);
          }
        }
      />
      {intent && !boundary.suspended && intent.epoch === boundary.epoch && (
        <EventCreateDialog
          key={`${intent.epoch}:${intent.date}:${intent.projectId}`}
          date={intent.date}
          projectId={intent.projectId}
          boundary={boundary}
          readBoundary={readBoundary}
          onClose={
            /** Close the current draft after its own discard safeguards. */ () => {
              if (admitted() && activeIntent.current === intent) {
                activeIntent.current = null;
                setIntent(null);
              }
            }
          }
          restoreFocus={
            /** Return focus to the surviving Calendar create opener. */ () => {
              if (admitted())
                (opener.current?.isConnected
                  ? opener.current
                  : document.querySelector<HTMLElement>("h1")
                )?.focus();
            }
          }
          onCreated={
            /** Open the committed ID and remount read owners even without native invalidation. */ (
              event,
            ) => {
              if (!admitted() || activeIntent.current !== intent) return;
              activeIntent.current = null;
              const next = new URLSearchParams(params);
              next.set("event", event.id);
              setIntent(null);
              setParams(next);
              setRefresh(
                /** Re-read month and agenda after the acknowledged mutation. */ (value) =>
                  value + 1,
              );
            }
          }
        />
      )}
    </>
  );
}
