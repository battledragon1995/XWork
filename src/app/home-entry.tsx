import { useCallback } from "react";
import { HomeRoute } from "@/features/home/home-route";
import { useDataManagement } from "@/features/settings/data-management-provider";
import { useQuitStore } from "./quit-store";

/** Compose live maintenance and Quit state without changing provider or route identity. */
export function HomeEntry() {
  const { busy, invalidationEpoch, getCurrent } = useDataManagement();
  const phase = useQuitStore((state) => state.phase);
  /** Read the owner stores synchronously to block stale clicks and promise completions. */
  const readBoundary = useCallback(() => {
    const data = getCurrent();
    const quit = useQuitStore.getState().phase;
    return {
      epoch: data.invalidationEpoch,
      suspended: data.busy || (quit !== "idle" && quit !== "snapshot-failed"),
    };
  }, [getCurrent]);
  return (
    <HomeRoute
      boundary={{
        epoch: invalidationEpoch,
        suspended: busy || (phase !== "idle" && phase !== "snapshot-failed"),
      }}
      readBoundary={readBoundary}
    />
  );
}
