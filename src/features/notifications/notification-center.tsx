import { Bell, CheckCircle2, CircleAlert, MessageSquare, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HighlightItem } from "@/components/animate-ui/primitives/effects/highlight";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type NotificationCenterProps, useNotifications } from "./use-notifications";

/** Formats only valid Date-domain decimal timestamps and clamps future activity to now. */
export function notificationTime(value: string, now: number): { label: string; title: string } {
  if (
    !/^-?\d+$/.test(value) ||
    BigInt(value) < -8640000000000000n ||
    BigInt(value) > 8640000000000000n
  )
    return { label: "Time unavailable", title: "Time unavailable" };
  const ms = Number(value);
  const minutes = Math.floor(Math.max(0, now - ms) / 60000);
  return {
    label:
      minutes < 1
        ? "now"
        : minutes < 60
          ? `${minutes}m`
          : minutes < 1440
            ? `${Math.floor(minutes / 60)}h`
            : `${Math.floor(minutes / 1440)}d`,
    title: new Date(ms).toLocaleString("en-US", { dateStyle: "full", timeStyle: "long" }),
  };
}

/** Renders backend-owned notification activity and explicit actions in one persistent entry. */
export function NotificationCenter(props: NotificationCenterProps) {
  const inbox = useNotifications(props);
  const titleId = useId();
  const panelId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const suppressRestore = useRef(false);
  const openKey = useRef(props.dismissKey);
  const focusedRow = useRef<{ id: string; index: number; action: string } | null>(null);
  const [now, setNow] = useState(Date.now);

  // A single timer updates visible relative labels and is absent while the panel is closed.
  useEffect(() => {
    if (!inbox.isOpen) return;
    setNow(Date.now());
    // Update all rows together instead of allocating a timer per notification.
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [inbox.isOpen]);

  // Preserve action focus across read/delete/refetch without taking focus from outside controls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: replaced rows can remove the focused action.
  useLayoutEffect(() => {
    if (!inbox.isOpen || inbox.disabled || !focusedRow.current || !panel.current) return;
    const active = document.activeElement;
    if (active !== document.body && active !== null && !panel.current.contains(active)) return;
    const previous = focusedRow.current;
    const rows = [...panel.current.querySelectorAll<HTMLElement>("[data-notification-id]")];
    // Match opaque IDs by equality; never interpolate them into selectors.
    const row =
      rows.find((entry) => entry.dataset.notificationId === previous.id) ??
      rows[Math.min(previous.index, rows.length - 1)];
    const buttons = row ? [...row.querySelectorAll<HTMLButtonElement>("button")] : [];
    // Prefer the old action; Mark read disappears after its successful mutation.
    const button = buttons.find((entry) => entry.dataset.action === previous.action) ?? buttons[0];
    (button ?? heading.current)?.focus();
  }, [inbox.items, inbox.disabled, inbox.isOpen]);

  /** Records whether close should restore the bell or honor an outside/navigation target. */
  function setOpen(open: boolean) {
    if (open) {
      suppressRestore.current = false;
      openKey.current = props.dismissKey;
      focusedRow.current = null;
    }
    inbox.setOpen(open);
  }
  /** Retains action identity before asynchronous replacement or removal. */
  function rememberFocus(event: React.FocusEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-notification-id]");
    const rows = [...(panel.current?.querySelectorAll("[data-notification-id]") ?? [])];
    focusedRow.current = row
      ? {
          id: row.dataset.notificationId ?? "",
          index: rows.indexOf(row),
          action: target.dataset.action ?? "open",
        }
      : null;
  }

  return (
    <Popover open={inbox.isOpen && !props.suspended} onOpenChange={setOpen}>
      <Tooltip>
        <HighlightItem asChild activeClassName="bg-surface-card">
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                ref={bell}
                type="button"
                disabled={props.suspended}
                aria-label={
                  inbox.unreadCount === null
                    ? "Notifications"
                    : `Notifications, ${inbox.unreadCount} unread`
                }
                aria-haspopup="dialog"
                aria-controls={panelId}
                className="relative z-[1] flex h-10 w-11 cursor-default items-center justify-center text-body outline-none [&:not([data-highlight])]:hover:bg-surface-card active:bg-cream-strong focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell aria-hidden="true" className="size-4" />
                {inbox.unreadCount !== null && inbox.unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-0 rounded-full bg-ink px-1 text-[10px] text-on-dark"
                  >
                    {inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
        </HighlightItem>
        <TooltipContent side="bottom">Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent
        ref={panel}
        id={panelId}
        aria-labelledby={titleId}
        onFocusCapture={rememberFocus}
        className="flex max-h-[min(600px,calc(100dvh-64px))] w-[400px] max-w-[calc(100vw-16px)] flex-col overflow-hidden motion-reduce:animate-none"
        // Focus a stable heading before any mutable actions.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        // Route/Quit takes focus precedence; outside clicks retain their clicked target.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!suppressRestore.current && !props.suspended && openKey.current === props.dismissKey)
            bell.current?.focus();
        }}
        // Do not restore the bell after clicking another control or starting navigation.
        onInteractOutside={() => {
          suppressRestore.current = true;
        }}
        // Portals still bubble React events through the titlebar.
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline p-3">
          <h2
            ref={heading}
            id={titleId}
            tabIndex={-1}
            className="mr-auto font-semibold outline-none"
          >
            Notifications
          </h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={inbox.disabled || !inbox.unreadCount}
            onClick={() => void inbox.mutate("readAll")}
          >
            Mark all read
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={inbox.disabled}
                onClick={() => void inbox.mutate("clearRead")}
              >
                Clear read
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete all read notifications. Sessions keep running.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close notifications</TooltipContent>
          </Tooltip>
        </div>
        <div
          className="min-h-0 overflow-y-auto p-3"
          aria-busy={inbox.refreshing || inbox.loadingMore}
        >
          {inbox.pageRevision === null && inbox.status === "loading" && (
            <p role="status">Loading notifications…</p>
          )}
          {inbox.pageRevision !== null && inbox.refreshing && (
            <p role="status">Updating notifications…</p>
          )}
          {inbox.status === "error" && (
            <div role="alert">
              <p>Couldn't load notifications.</p>
              {inbox.pageRevision !== null && <p>Notifications may be out of date.</p>}
            </div>
          )}
          {inbox.listenerFailed && <p role="alert">Live updates are unavailable.</p>}
          {inbox.errorMessage && <p role="alert">{inbox.errorMessage}</p>}
          {(inbox.status === "error" || inbox.listenerFailed) && (
            <Button variant="outline" size="sm" onClick={inbox.retry}>
              Retry
            </Button>
          )}
          <p role="status" aria-live="polite">
            {inbox.pending ? "Working…" : ""}
          </p>
          {inbox.status === "ready" && inbox.items.length === 0 && (
            <div className="py-6 text-center">
              <p>No notifications yet</p>
              <p className="text-sm text-muted">Unseen terminal activity will appear here.</p>
            </div>
          )}
          <ul className="space-y-2">
            {/* Render sanitized snapshots as plain text, without inventing unavailable context. */}
            {inbox.items.map((item) => {
              const Icon =
                item.kind === "terminalNeedsInput"
                  ? MessageSquare
                  : item.kind === "terminalProcessFailed"
                    ? CircleAlert
                    : CheckCircle2;
              const time = notificationTime(item.createdAtMs, now);
              return (
                <li
                  key={item.id}
                  data-notification-id={item.id}
                  className={
                    item.readAtMs === null ? "rounded-md bg-surface-soft p-3" : "rounded-md p-3"
                  }
                >
                  <div className="flex items-start gap-2">
                    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1 break-words">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted">{item.context}</p>
                    </div>
                    <span title={time.title} className="shrink-0 text-xs text-muted">
                      {time.label}
                    </span>
                  </div>
                  <span className="text-xs text-muted">
                    {item.readAtMs === null ? "● Unread" : "Read"}
                  </span>
                  {item.statusCode !== null && (
                    <p className="text-xs text-muted">Exit code: {item.statusCode}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      data-action="open"
                      size="sm"
                      variant="outline"
                      disabled={inbox.disabled}
                      onClick={() => void inbox.mutate("open", item.id)}
                    >
                      Open session
                    </Button>
                    {item.readAtMs === null && (
                      <Button
                        data-action="read"
                        size="sm"
                        variant="ghost"
                        disabled={inbox.disabled}
                        onClick={() => void inbox.mutate("read", item.id)}
                      >
                        Mark read
                      </Button>
                    )}
                    <Button
                      data-action="delete"
                      size="sm"
                      variant="ghost"
                      disabled={inbox.disabled}
                      onClick={() => void inbox.mutate("delete", item.id)}
                    >
                      Delete notification
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="shrink-0 border-t border-hairline p-3 text-xs text-muted">
          {inbox.nextCursor && (
            <Button
              className="mb-2 w-full"
              size="sm"
              variant="outline"
              disabled={inbox.disabled}
              onClick={inbox.loadMore}
            >
              {inbox.loadingMore ? "Loading more…" : "Load more"}
            </Button>
          )}
          <p>Only unseen terminal activity appears here.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
