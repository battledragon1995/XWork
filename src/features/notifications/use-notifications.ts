import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  NotificationCenterChangedDto,
  NotificationCursorDto,
  NotificationDto,
  NotificationTargetDto,
} from "@/bindings/notifications/notifications";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/notifications";

export interface NotificationCenterProps {
  /** Activates the validated target while respecting dismissal. */
  onOpenTarget(target: NotificationTargetDto, signal: AbortSignal): Promise<void>;
  dismissKey: string;
  suspended: boolean;
}
type Action = "read" | "readAll" | "delete" | "clearRead" | "open";
interface State {
  isOpen: boolean;
  status: "loading" | "ready" | "error";
  items: NotificationDto[];
  nextCursor: NotificationCursorDto | null;
  revision: string | null;
  pageRevision: string | null;
  unreadCount: number | null;
  dirty: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  listening: boolean;
  listenerFailed: boolean;
  pending: Action | null;
  errorMessage: string | null;
}
const initial: State = {
  isOpen: false,
  status: "loading",
  items: [],
  nextCursor: null,
  revision: null,
  pageRevision: null,
  unreadCount: null,
  dirty: true,
  refreshing: false,
  loadingMore: false,
  listening: false,
  listenerFailed: false,
  pending: null,
  errorMessage: null,
};
/** Reads only the stable tagged category, never raw native error text. */
function errorCode(error: unknown): string | undefined {
  return error instanceof IpcCallError ? error.payload?.code : undefined;
}
/** Maps notification failures to actionable English copy. */
function errorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "notification_not_found":
      return "This notification is no longer available.";
    case "target_unavailable":
      return "This session is no longer available.";
    case "dependency_unavailable":
    case "persistence_failed":
    case "unavailable":
      return "Notifications are temporarily unavailable. Try again.";
    case "unauthorized_window":
    case "invalid_notification_id":
    case "invalid_limit":
    case "corrupt_stored_notification":
      return "Notifications couldn't be loaded. Restart XWork.";
    case "sessionNotFound":
    case "tabNotFound":
    case "paneNotFound":
    case "projectNotFound":
      return "This session is no longer available.";
    default:
      return "Couldn't update notifications. Try again.";
  }
}
/** Reconciles one mounted inbox; closures isolate StrictMode owners and late promises. */
export function useNotifications(props: NotificationCenterProps) {
  const [state, setState] = useState<State>(initial);
  const latest = useRef(props);
  latest.current = props;
  const controls = useRef<{
    /** Changes the panel and cancels pending navigation when closing. */
    setOpen(open: boolean): void;
    /** Retries registration and refreshes the first page. */
    retry(): void;
    /** Requests one additional cursor page. */
    loadMore(): void;
    /** Performs one explicit backend mutation. */
    mutate(action: Action, id?: string): Promise<void>;
  } | null>(null);

  // Each lifecycle owns its requests, subscription, coalescing timer and abort token.
  useEffect(() => {
    let live = true;
    let current = { ...initial };
    let started = false;
    let querying = false;
    let queued = false;
    let epoch = 0;
    let unlisten: (() => void) | undefined;
    let subscribing: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    /** Publishes only for this owner and keeps async decisions synchronous. */
    function patch(change: Partial<State>) {
      if (!live) return;
      current = { ...current, ...change };
      setState(current);
    }
    /** Applies authoritative count monotonically using decimal-safe comparison. */
    function accept(value: NotificationCenterChangedDto): boolean {
      if (current.revision !== null && BigInt(value.revision) < BigInt(current.revision))
        return false;
      patch({ revision: value.revision, unreadCount: value.unreadCount });
      return true;
    }
    /** Serializes pages and collapses concurrent invalidations into one first-page read. */
    async function query(more = false, recover = true): Promise<void> {
      if (!live || !started) return;
      if (querying) {
        if (!more) queued = true;
        return;
      }
      if (more && (!current.nextCursor || current.dirty || current.pending)) return;
      querying = true;
      const cursor = more ? current.nextCursor : null;
      const baseRevision = current.pageRevision;
      const queryEpoch = epoch;
      patch({ refreshing: !more, loadingMore: more });
      try {
        const page = await ipc.getNotifications(cursor, 30);
        if (!live) return;
        const stale =
          queryEpoch !== epoch ||
          (current.revision !== null && BigInt(page.revision) < BigInt(current.revision));
        if (stale || (more && page.revision !== baseRevision)) {
          accept(page);
          patch({ dirty: true });
          queued = true;
        } else {
          accept(page);
          const rows = more ? [...current.items, ...page.items] : page.items;
          const unique = new Map<string, NotificationDto>();
          // Keep backend ordering while removing duplicate cursor boundaries.
          for (const row of rows) unique.set(row.id, row);
          patch({
            items: [...unique.values()],
            nextCursor: page.nextCursor,
            pageRevision: page.revision,
            status: "ready",
            dirty: false,
            errorMessage: current.status === "error" ? null : current.errorMessage,
          });
        }
      } catch (error) {
        if (!live) return;
        if (errorCode(error) === "invalid_cursor" && recover) {
          patch({ nextCursor: null, dirty: true });
          queued = true;
        } else {
          patch({
            status: "error",
            dirty: true,
            errorMessage: errorCode(error) ? errorMessage(error) : "Couldn't load notifications.",
          });
        }
      } finally {
        querying = false;
        patch({ refreshing: false, loadingMore: false });
        if (live && queued) {
          queued = false;
          void query(false, false);
        }
      }
    }
    /** Invalidates open pages in one short batch; closed panels only retain dirty state. */
    function changed(value: NotificationCenterChangedDto) {
      if (
        !live ||
        (current.revision !== null && BigInt(value.revision) <= BigInt(current.revision))
      )
        return;
      accept(value);
      epoch += 1;
      patch({ dirty: true });
      if (current.isOpen && timer === undefined) {
        // Coalesce a burst without postponing it indefinitely.
        timer = setTimeout(() => {
          timer = undefined;
          void query();
        }, 100);
      }
    }
    /** Retries only a failed listener and tears down registrations resolving after unmount. */
    async function subscribe() {
      if (unlisten || subscribing) return subscribing;
      // Share an in-flight registration so Retry cannot create duplicate listeners.
      subscribing = (async () => {
        try {
          const stop = await ipc.onNotificationsChanged(changed);
          if (!live) {
            stop();
            return;
          }
          unlisten = stop;
          patch({ listening: true, listenerFailed: false });
        } catch {
          patch({ listening: false, listenerFailed: true });
        } finally {
          subscribing = null;
        }
      })();
      return subscribing;
    }
    /** Refreshes after missed events without polling hidden windows. */
    function regainAttention() {
      if (document.visibilityState === "visible") void query();
    }
    controls.current = {
      /** Keeps close usable during commands and invalidates only UI navigation. */
      setOpen(open) {
        if (open && latest.current.suspended) return;
        if (!open) controller?.abort();
        patch({ isOpen: open });
        if (open) void query();
      },
      /** Re-establishes events before retrieving a replacement snapshot. */
      retry() {
        patch({ errorMessage: null });
        // The initial query is allowed even when listener registration fails.
        void subscribe().then(() => {
          if (live) {
            started = true;
            void query();
          }
        });
      },
      /** Loads at most one cursor request when actions are safe. */
      loadMore() {
        void query(true);
      },
      /** Reconciles every command, including no-ops and uncertain transport failures. */
      async mutate(action, id) {
        if (
          !live ||
          latest.current.suspended ||
          current.pending ||
          current.dirty ||
          querying ||
          current.status !== "ready"
        )
          return;
        patch({ pending: action, errorMessage: null });
        const attempt = action === "open" ? new AbortController() : null;
        controller = attempt;
        try {
          if (action === "open") {
            const result = await ipc.openNotification(id ?? "");
            if (!live) return;
            accept(result.state);
            epoch += 1;
            patch({ dirty: true });
            void query();
            if (attempt && !attempt.signal.aborted) {
              try {
                await latest.current.onOpenTarget(result.target, attempt.signal);
              } catch (error) {
                if (!attempt.signal.aborted)
                  patch({
                    errorMessage: [
                      "target_unavailable",
                      "sessionNotFound",
                      "tabNotFound",
                      "paneNotFound",
                      "projectNotFound",
                    ].includes(errorCode(error) ?? "")
                      ? "This session is no longer available."
                      : "Couldn't open this session. Try again.",
                  });
                return;
              }
              if (!attempt.signal.aborted) patch({ isOpen: false });
            }
          } else {
            const result = await (action === "read"
              ? ipc.markNotificationRead(id ?? "")
              : action === "delete"
                ? ipc.deleteNotification(id ?? "")
                : action === "readAll"
                  ? ipc.markAllNotificationsRead()
                  : ipc.clearReadNotifications());
            if (live) accept(result);
          }
        } catch (error) {
          if (!attempt?.signal.aborted) patch({ errorMessage: errorMessage(error) });
        } finally {
          if (live) {
            epoch += 1;
            patch({ pending: null, dirty: true });
            void query();
          }
          if (controller === attempt) controller = null;
        }
      },
    };
    window.addEventListener("focus", regainAttention);
    document.addEventListener("visibilitychange", regainAttention);
    controls.current.retry();
    // Old owners cannot publish or retain subscriptions, even after delayed registration.
    return () => {
      live = false;
      controller?.abort();
      unlisten?.();
      clearTimeout(timer);
      window.removeEventListener("focus", regainAttention);
      document.removeEventListener("visibilitychange", regainAttention);
      controls.current = null;
    };
  }, []);

  // Invalidate navigation before passive effects or late command continuations can run.
  useLayoutEffect(() => {
    void props.dismissKey;
    void props.suspended;
    controls.current?.setOpen(false);
  }, [props.dismissKey, props.suspended]);

  return {
    ...state,
    disabled:
      state.status !== "ready" ||
      state.dirty ||
      state.refreshing ||
      state.loadingMore ||
      state.pending !== null ||
      props.suspended,
    /** Delegates to the currently mounted owner. */
    setOpen: (open: boolean) => controls.current?.setOpen(open),
    /** Retries the current owner's snapshot and subscription. */
    retry: () => controls.current?.retry(),
    /** Delegates cursor paging to its serialized query. */
    loadMore: () => controls.current?.loadMore(),
    /** Runs only explicit user mutations. */
    mutate: (action: Action, id?: string) => controls.current?.mutate(action, id),
  };
}
