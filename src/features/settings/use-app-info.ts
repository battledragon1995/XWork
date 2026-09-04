import { useCallback, useEffect, useRef, useState } from "react";
import { type AppInfo, readAppInfo } from "@/lib/ipc/app-info";

/** State exposed by the isolated About information reader. */
interface AppInfoState {
  status: "loading" | "ready" | "error";
  info: AppInfo | null;
}

/** Read About facts safely and offer one non-overlapping explicit reload action. */
export function useAppInfo(): AppInfoState & { reload(): void } {
  const [state, setState] = useState<AppInfoState>({ status: "loading", info: null });
  const active = useRef(false);
  const generation = useRef(0);
  const pendingGeneration = useRef<number | null>(null);

  // Start one atomic adapter read and publish it only for the latest active generation.
  const reload = useCallback(() => {
    if (pendingGeneration.current !== null) {
      return;
    }

    generation.current += 1;
    const requestGeneration = generation.current;
    pendingGeneration.current = requestGeneration;
    setState({ status: "loading", info: null });

    void readAppInfo()
      .then((info) => {
        if (active.current && generation.current === requestGeneration) {
          setState({ status: "ready", info });
        }
      })
      .catch(() => {
        if (active.current && generation.current === requestGeneration) {
          setState({ status: "error", info: null });
        }
      })
      .finally(() => {
        if (pendingGeneration.current === requestGeneration) {
          pendingGeneration.current = null;
        }
      });
  }, []);

  useEffect(() => {
    active.current = true;
    reload();

    // Invalidate a late completion and allow a development effect remount to start afresh.
    return () => {
      active.current = false;
      generation.current += 1;
      pendingGeneration.current = null;
    };
  }, [reload]);

  return { ...state, reload };
}
