import { useEffect } from "react";
import { useNavigate } from "react-router";
import { onNavigateSession, onQuitRequested, type UnlistenFn } from "@/lib/ipc/app-lifecycle";
import { useQuitStore } from "./quit-store";

/**
 * Bridge the two backend lifecycle events into the shell. It must be mounted exactly once and
 * inside router context, because a tray session entry navigates. Both subscriptions are
 * removed on unmount so a hot reload cannot leave a second copy of either handler behind.
 */
export function useLifecycleEvents(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const unlistens: UnlistenFn[] = [];

    // Subscribe to both events and remember how to undo it. If the bridge unmounted while the
    // subscriptions were still resolving, they are removed immediately instead of leaking.
    async function subscribe(): Promise<void> {
      const registered = await Promise.all([
        onQuitRequested((request) => {
          useQuitStore.getState().receiveTrayRequest(request);
        }),
        onNavigateSession((target) => {
          // The session id is opaque, so it is forwarded exactly as the backend sent it.
          void navigate(`/sessions/${target.sessionId}`);
        }),
      ]);

      if (!isMounted) {
        for (const unlisten of registered) {
          unlisten();
        }
        return;
      }

      unlistens.push(...registered);
    }

    void subscribe();

    return () => {
      isMounted = false;
      for (const unlisten of unlistens) {
        unlisten();
      }
    };
  }, [navigate]);
}
