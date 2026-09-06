import { useOptionalDataManagement } from "@/features/settings/data-management-provider";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { SearchTargetDto } from "@/bindings/search";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette, type SearchTargetAvailability } from "@/features/search";
import { useKeyboardShortcuts } from "@/features/settings/keyboard-shortcuts-provider";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getProject } from "@/lib/ipc/projects";
import { createSession, getSession } from "@/lib/ipc/sessions";
import { formatShortcut, matchesShortcut } from "@/lib/utils/keyboard-shortcuts";
import { useQuitStore } from "./quit-store";

const ROUTES: Record<string, string> = {
  "navigation.open_home": "/",
  "navigation.open_projects": "/projects",
  "settings.open_general": "/settings/general",
  "settings.open_appearance": "/settings/appearance",
  "settings.open_cli_profiles": "/settings/terminal-profiles",
  "settings.open_keyboard_shortcuts": "/settings/keyboard-shortcuts",
};
const UNAVAILABLE = new Set([
  "navigation.previous_project",
  "navigation.next_project",
  "navigation.previous_session",
  "navigation.next_session",
  "navigation.previous_tab",
  "navigation.next_tab",
  "panes.focus_up",
  "panes.focus_down",
  "panes.focus_left",
  "panes.focus_right",
]);

/** Fail closed for catalog entries that have no public palette executor. */
function availability(target: SearchTargetDto): SearchTargetAvailability {
  if (target.kind === "file")
    return {
      enabled: false,
      reason: "File opening will be available in the next Files update.",
    };
  if (
    target.kind !== "command" ||
    Object.hasOwn(ROUTES, target.actionId) ||
    (target.actionId === "sessions.create_current_project" && target.projectId !== null)
  )
    return { enabled: true, reason: null };
  return {
    enabled: false,
    reason: UNAVAILABLE.has(target.actionId)
      ? "Not available yet."
      : "Not available in Command Palette yet.",
  };
}

/** Compose route context, configured keyboard dispatch and the seven existing owner actions. */
export function SearchEntry() {
  const data = useOptionalDataManagement();
  const location = useLocation();
  const navigate = useNavigate();
  const shortcuts = useKeyboardShortcuts();
  const phase = useQuitStore((state) => state.phase);
  const suspended = (phase !== "idle" && phase !== "snapshot-failed") || (data?.busy ?? false);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<{ ready: boolean; projectId: string | null }>({
    ready: false,
    projectId: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pill = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restore = useRef(false);
  const openedRoute = useRef(location.key);
  const controller = useRef<AbortController | null>(null);
  const flight = useRef(false);
  const live = useRef(true);
  const previousSnapshot = useRef(shortcuts.snapshot);
  const current = useRef({ route: location.key, suspended });
  current.current = { route: location.key, suspended };
  const action = shortcuts.snapshot?.actions.find(
    // Match the stable action ID, never its translated display label.
    (entry) => entry.actionId === "search.open_command_palette",
  );
  const chord =
    action && shortcuts.platform && shortcuts.status === "ready" && shortcuts.pending === null
      ? formatShortcut(action.currentChord, shortcuts.platform)
      : null;
  const dispatchable =
    shortcuts.status === "ready" &&
    shortcuts.pending === null &&
    shortcuts.platform !== null &&
    action?.isDispatchable === true &&
    action.conflictsWith.length === 0;
  /** Retire subsequent UI steps while retaining any mutation's single-flight lock. */
  const close = useCallback((restoreFocus: boolean) => {
    restore.current = restoreFocus;
    controller.current?.abort();
    setOpen(false);
  }, []);
  /** Start a clean palette lifetime without resetting an unresolved mutation lock. */
  function show() {
    if (
      suspended ||
      data?.getCurrent().busy ||
      document.hidden ||
      open ||
      document.querySelector('[aria-modal="true"][role="dialog"], [role="alertdialog"]')
    )
      return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openedRoute.current = location.key;
    controller.current?.abort();
    controller.current = new AbortController();
    restore.current = false;
    setContext({ ready: false, projectId: null });
    setError(null);
    setOpen(true);
  }
  useEffect(
    /** Retire old query/focus work after every maintenance invalidation. */ () => {
      if (data?.invalidationEpoch) close(false);
    },
    [data?.invalidationEpoch, close],
  );
  useEffect(() => {
    if (previousSnapshot.current !== shortcuts.snapshot) {
      previousSnapshot.current = shortcuts.snapshot;
      setRefreshKey((value) => value + 1);
    }
  }, [shortcuts.snapshot]);
  useEffect(() => {
    live.current = true;
    /** Never restore focus or navigate after this entry is removed. */
    return () => {
      live.current = false;
      restore.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (open && (openedRoute.current !== location.key || suspended)) close(false);
  }, [location.key, suspended, open, close]);
  useEffect(() => {
    /** Hidden windows abandon query and execution UI, not committed backend work. */
    const visibility = () => {
      if (document.hidden) close(false);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [close]);
  useEffect(() => {
    if (!open) return;
    let retired = false;
    /** Resolve route identities from the public owner before sending contextual search. */
    async function resolveContext() {
      const epoch = data?.getCurrent().invalidationEpoch;
      let projectId: string | null = null;
      try {
        const project = /^\/projects\/([^/]+)\/?$/.exec(location.pathname);
        const session = /^\/sessions\/([^/]+)\/?$/.exec(location.pathname);
        if (project?.[1]) {
          const id = decodeURIComponent(project[1]);
          const detail = await getProject(id);
          if (detail.id === id) projectId = detail.id;
        } else if (session?.[1]) {
          const id = decodeURIComponent(session[1]);
          const detail = await getSession(id);
          if (detail.summary.id === id) projectId = detail.summary.projectId;
        }
      } catch {
        /* Global search remains available when route context cannot be read. */
      }
      if (!retired && !data?.getCurrent().busy && data?.getCurrent().invalidationEpoch === epoch)
        setContext({ ready: true, projectId });
    }
    void resolveContext();
    return () => {
      retired = true;
    };
  }, [open, location.pathname, data?.getCurrent]);
  useEffect(() => {
    if (!dispatchable || suspended || open || !action || !shortcuts.platform) return;
    const platform = shortcuts.platform;
    /** Capture only an accepted chord so terminal and editable controls do not receive it. */
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.hidden ||
        document.querySelector('[aria-modal="true"][role="dialog"], [role="alertdialog"]') ||
        !matchesShortcut(event, action.currentChord, platform)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      show();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  /** Execute a single owner operation and stop late navigation on any lifetime change. */
  async function activate(target: SearchTargetDto) {
    const signal = controller.current?.signal;
    if (!open || !signal || signal.aborted || flight.current || !availability(target).enabled)
      return;
    flight.current = true;
    setBusy(true);
    setError(null);
    const route = location.key;
    const epoch = data?.getCurrent().invalidationEpoch;
    /** Check the rendered route and Quit state even before cleanup effects run. */
    const valid = () =>
      data?.getCurrent().invalidationEpoch === epoch &&
      !data?.getCurrent().busy &&
      live.current &&
      !signal.aborted &&
      !document.hidden &&
      !current.current.suspended &&
      current.current.route === route;
    let creating = false;
    try {
      let destination: string;
      if (target.kind === "project") {
        const detail = await getProject(target.projectId);
        if (detail.id !== target.projectId)
          throw new IpcCallError("get_project", { code: "target_unavailable" });
        destination = `/projects/${encodeURIComponent(detail.id)}`;
      } else if (target.kind === "session") {
        const detail = await getSession(target.sessionId);
        if (detail.summary.id !== target.sessionId || detail.summary.projectId !== target.projectId)
          throw new IpcCallError("get_session", { code: "target_unavailable" });
        destination = `/sessions/${encodeURIComponent(detail.summary.id)}`;
      } else if (target.kind === "file") {
        return;
      } else if (
        target.actionId === "sessions.create_current_project" &&
        target.projectId !== null
      ) {
        creating = true;
        const detail = await createSession(target.projectId);
        destination = `/sessions/${encodeURIComponent(detail.summary.id)}`;
      } else {
        const path = ROUTES[target.actionId];
        if (!Object.hasOwn(ROUTES, target.actionId) || !path) return;
        destination = path;
      }
      if (!valid()) return;
      const same = destination === location.pathname;
      if (same) opener.current = pill.current;
      close(same);
      if (!same) await navigate(destination);
    } catch (cause) {
      if (!valid()) return;
      const code = cause instanceof IpcCallError ? (cause.payload?.code ?? null) : null;
      if (
        ["target_unavailable", "projectNotFound", "project_not_found", "sessionNotFound"].includes(
          code ?? "",
        )
      ) {
        setError("This result is no longer available.");
        setRefreshKey((value) => value + 1);
      } else if (code === "projectUnavailable")
        setError("This project is unavailable. Open its overview to locate the folder.");
      else if (code === "runtimeShuttingDown")
        setError("XWork is shutting down. Try again after restarting.");
      else if (creating && code === null)
        setError(
          "Could not confirm session creation. Check the project sessions before trying again.",
        );
      else
        setError(
          creating
            ? "Could not create a session. Try again."
            : "Could not open this result. Try again.",
        );
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  /** Restore only after modal release and only to the still-current user dismissal owner. */
  function onClosed() {
    if (
      !restore.current ||
      !live.current ||
      current.current.suspended ||
      document.hidden ||
      current.current.route !== openedRoute.current
    )
      return;
    restore.current = false;
    (opener.current?.isConnected ? opener.current : pill.current)?.focus();
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={pill}
            disabled={suspended}
            onClick={show}
            aria-haspopup="dialog"
            aria-label="Search or run a command"
            className="flex min-h-7 w-[320px] cursor-default items-center gap-2 rounded-md border border-hairline bg-surface-soft pr-2 pl-2.5 text-[13px] text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Search or run a command</span>
            {chord && <kbd className="ml-auto text-xs">{chord}</kbd>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {action && action.conflictsWith.length > 0
            ? "Shortcut conflict"
            : chord && dispatchable
              ? `Search or run a command (${chord})`
              : "Search or run a command"}
        </TooltipContent>
      </Tooltip>
      <CommandPalette
        open={open && !suspended && openedRoute.current === location.key}
        contextProjectId={context.projectId}
        contextReady={context.ready}
        platform={shortcuts.platform}
        refreshKey={refreshKey + (data?.invalidationEpoch ?? 0)}
        busy={busy}
        executionError={error}
        onClose={() => close(true)}
        onClosed={onClosed}
        getTargetAvailability={availability}
        onActivate={activate}
      />
    </>
  );
}
