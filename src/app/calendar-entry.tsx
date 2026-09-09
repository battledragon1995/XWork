import { useCallback } from "react";
import { CalendarRoute, type CalendarBoundary } from "@/features/calendar";
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
  return <CalendarRoute {...useCalendarBoundary()} />;
}
