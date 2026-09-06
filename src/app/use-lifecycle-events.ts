import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { QuitRequestDto } from "@/bindings/app-lifecycle";
import { useOptionalDataManagement } from "@/features/settings/data-management-provider";
import {
  cancelQuit,
  onNavigateSession,
  onQuitRequested,
  type UnlistenFn,
} from "@/lib/ipc/app-lifecycle";
import { getSession } from "@/lib/ipc/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { useQuitStore } from "./quit-store";

/** Serialize frontend/tray Quit intentions with Data and validate tray navigation targets. */
export function useLifecycleEvents(): () => Promise<void> {
  const navigate = useNavigate();
  const data = useOptionalDataManagement();
  const current = useRef(data);
  current.current = data;
  const pending = useRef<{ tray: QuitRequestDto | null; refresh: boolean } | null>(null);
  const processing = useRef(false);
  const live = useRef(true);
  /** Retire preview first and obtain fresh impact after a Data operation settles. */
  const drain = useCallback(async () => {
    if (processing.current || !pending.current || current.current?.getCurrent().busy) return;
    processing.current = true;
    const intent = pending.current;
    pending.current = null;
    try {
      if (current.current?.getCurrent().phase === "preview") await current.current.retirePreview();
      if (!live.current) return;
      if (intent.tray && intent.refresh) {
        try {
          await cancelQuit(intent.tray.requestId);
        } catch (error) {
          if (!(error instanceof IpcCallError) || error.payload?.code !== "stale_quit_request") {
            useQuitStore.setState({
              phase: "integration-failed",
              request: null,
              failure: { stage: "integration", code: "unknown" },
            });
            return;
          }
        }
      }
      if (intent.tray && !intent.refresh) useQuitStore.getState().receiveTrayRequest(intent.tray);
      else await useQuitStore.getState().startQuit();
    } finally {
      processing.current = false;
    }
  }, []);
  /** Queue an explicit menu intent; never auto-confirm Quit. */
  async function startQuit() {
    pending.current = { tray: null, refresh: true };
    await drain();
  }
  useEffect(
    /** Drain the remembered intent when Data's actual apply lock releases. */ () => {
      if (!data?.busy) void drain();
    },
    [data?.busy, drain],
  );
  useEffect(
    /** Register each native listener independently and clean up late registrations. */ () => {
      live.current = true;
      let active = true;
      const unlistens: UnlistenFn[] = [];
      /** Retain or immediately dispose an asynchronous listener. */
      function remember(unlisten: UnlistenFn) {
        if (active) unlistens.push(unlisten);
        else unlisten();
      }
      void onQuitRequested(
        /** Defer tray impact while Data owns dialog focus. */ (request) => {
          if (!active) return;
          const snapshot = current.current?.getCurrent();
          pending.current = {
            tray: request,
            refresh: !!snapshot && (snapshot.busy || snapshot.phase === "preview"),
          };
          void drain();
        },
      )
        .then(remember)
        .catch(
          /** Surface a lost Quit integration without raw diagnostics. */ () => {
            if (active)
              useQuitStore.setState({
                phase: "integration-failed",
                failure: { stage: "integration", code: "unknown" },
              });
          },
        );
      void onNavigateSession(
        /** Validate the target against current runtime before routing. */ async (target) => {
          const snapshot = current.current?.getCurrent();
          if (!active || snapshot?.busy) return;
          const epoch = snapshot?.invalidationEpoch;
          try {
            const detail = await getSession(target.sessionId);
            if (
              active &&
              !current.current?.getCurrent().busy &&
              current.current?.getCurrent().invalidationEpoch === epoch &&
              detail.summary.id === target.sessionId
            ) {
              void navigate(`/sessions/${encodeURIComponent(target.sessionId)}`);
            }
          } catch {
            /* Deleted and unavailable tray targets do not navigate. */
          }
        },
      )
        .then(remember)
        .catch(/** Navigation remains available through the visible UI. */ () => undefined);
      return () => {
        active = false;
        live.current = false;
        for (const unlisten of unlistens) unlisten();
      };
    },
    [navigate, drain],
  );
  return startQuit;
}
