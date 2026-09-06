const maintenance = vi.hoisted(() => ({ value: null as DataManagementState | null }));
/** Inject the public Data snapshot to exercise epochs before React rerenders. */
vi.mock("@/features/settings/data-management-provider", () => ({
  useOptionalDataManagement: () => maintenance.value,
}));
import {
  createDataManagementState,
  type DataManagementState,
} from "@/features/settings/data-management-state";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SearchTargetDto, UnifiedSearchResponseDto } from "@/bindings/search";
import type { SessionDetailDto } from "@/bindings/sessions/sessions";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { KeyboardShortcutsState } from "@/features/settings/keyboard-shortcuts-state";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getProject } from "@/lib/ipc/projects";
import { searchUnified } from "@/lib/ipc/search";
import { createSession, getSession } from "@/lib/ipc/sessions";
import { resetQuitStore, useQuitStore } from "./quit-store";
import { SearchEntry } from "./search-entry";

/** Keep the committed shortcut snapshot under direct test control. */
const state = vi.hoisted(() => ({ value: {} as KeyboardShortcutsState }));
/** Inject the public provider boundary, not its private implementation. */
vi.mock("@/features/settings/keyboard-shortcuts-provider", () => ({
  useKeyboardShortcuts: () => state.value,
}));
/** Isolate real owner reads and creation. */
vi.mock("@/lib/ipc/projects", () => ({ getProject: vi.fn() }));
/** Never create runtime sessions in a component test. */
vi.mock("@/lib/ipc/sessions", () => ({ getSession: vi.fn(), createSession: vi.fn() }));
/** Supply catalog targets through the real palette component. */
vi.mock("@/lib/ipc/search", () => ({ searchUnified: vi.fn() }));

/** Produce one finite backend result for owner execution tests. */
function response(target: SearchTargetDto): UnifiedSearchResponseDto {
  return {
    query: "",
    resultCount: 1,
    sourceFailures: [],
    groups: [
      {
        kind: target.kind,
        label: "Results",
        hasMore: false,
        results: [
          {
            key: "target",
            kind: target.kind,
            title: "Target result",
            context: null,
            titleHighlights: [],
            contextHighlights: [],
            target,
            shortcut: {
              primary: true,
              alt: false,
              shift: false,
              keyCode: "KeyT",
              isConflicted: true,
            },
            supportsOpenInSplit: false,
          },
        ],
      },
    ],
  };
}
/** Build the owner fields consumed by app composition. */
function detail(id = "s", projectId = "p"): SessionDetailDto {
  return { summary: { id, projectId } } as SessionDetailDto;
}
/** Expose navigation and editable input independently of the palette. */
function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TooltipProvider>
      <SearchEntry />
      <input aria-label="Terminal input" data-terminal-root />
      <button
        type="button"
        onClick={() => {
          void navigate("/calendar");
        }}
      >
        Other route
      </button>
      <output data-testid="route">{location.pathname}</output>
    </TooltipProvider>
  );
}
/** Mount one entry at the requested route. */
function mount(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );
}
/** Open and wait for an authoritative selectable row. */
async function open() {
  await userEvent.click(screen.getByRole("button", { name: "Search or run a command" }));
  await screen.findByRole("option");
}
/** Dispatch using the palette's actual input-held keyboard path. */
async function activate() {
  await act(async () => fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" }));
}
/** Reset isolated IPC and committed shortcuts before every scenario. */
beforeEach(() => {
  maintenance.value = null;
  vi.resetAllMocks();
  resetQuitStore();
  const chord = { primary: true, alt: false, shift: false, keyCode: "KeyK" };
  state.value = {
    snapshot: {
      actions: [
        {
          actionId: "search.open_command_palette",
          label: "Search",
          category: "global",
          scope: "application",
          currentChord: chord,
          defaultChord: chord,
          isCustom: false,
          conflictsWith: [],
          isDispatchable: true,
        },
      ],
    },
    platform: "windows",
    status: "ready",
    pending: null,
    error: null,
    settleBeforeDataChange: vi.fn(async () => {}),
    releaseDataChangeBarrier: vi.fn(),
    refreshAfterDataChange: vi.fn(async () => {}),
    refresh: vi.fn(),
    assign: vi.fn(),
    resetOne: vi.fn(),
    resetAll: vi.fn(),
  };
  vi.mocked(getProject).mockResolvedValue({ id: "p" } as Awaited<ReturnType<typeof getProject>>);
  vi.mocked(getSession).mockResolvedValue(detail());
  vi.mocked(createSession).mockResolvedValue(detail("new"));
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId: "navigation.open_projects", projectId: null }),
  );
});
/** Release portal lifetimes and Quit subscriptions. */
afterEach(() => {
  cleanup();
  resetQuitStore();
});

/** A pending route context cannot publish after the palette moves to another route. */
it("retires stale context resolution before reopening globally", async () => {
  let resolve!: (value: SessionDetailDto) => void;
  vi.mocked(getSession).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  mount("/sessions/s");
  await userEvent.click(screen.getByRole("button", { name: "Search or run a command" }));
  await screen.findByRole("combobox");
  expect(searchUnified).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Other route", hidden: true }));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  await open();
  await act(async () => resolve(detail("s", "old-project")));
  expect(searchUnified).toHaveBeenCalledExactlyOnceWith({ query: "", contextProjectId: null });
});

/** Only a replaced committed snapshot refreshes search; state-only renders do not. */
it("refreshes committed shortcut replacement without a render loop", async () => {
  const view = mount();
  await open();
  expect(searchUnified).toHaveBeenCalledTimes(1);
  view.rerender(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  await act(async () => {});
  expect(searchUnified).toHaveBeenCalledTimes(1);
  state.value = { ...state.value, snapshot: structuredClone(state.value.snapshot) };
  view.rerender(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  await waitFor(() => expect(searchUnified).toHaveBeenCalledTimes(2));
});

/** Same-route execution returns focus to the pill rather than the original editable control. */
it("restores the pill after a same-route command", async () => {
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId: "navigation.open_home", projectId: null }),
  );
  mount();
  screen.getByRole("textbox", { name: "Terminal input" }).focus();
  fireEvent.keyDown(document.activeElement ?? document.body, { code: "KeyK", ctrlKey: true });
  await screen.findByRole("option");
  await activate();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Search or run a command" })).toHaveFocus(),
  );
});

/** All static executors use exact route mappings, regardless of shortcut conflicts. */
it.each([
  ["navigation.open_home", "/"],
  ["navigation.open_projects", "/projects"],
  ["settings.open_general", "/settings/general"],
  ["settings.open_appearance", "/settings/appearance"],
  ["settings.open_cli_profiles", "/settings/terminal-profiles"],
  ["settings.open_keyboard_shortcuts", "/settings/keyboard-shortcuts"],
])("executes %s", async (actionId, destination) => {
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId, projectId: null }),
  );
  mount("/calendar");
  await open();
  await activate();
  await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent(destination));
  expect(createSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).toBeNull();
});
/** Unsupported action families stay visible and disabled, including prototype-like IDs. */
it.each([
  "tabs.create",
  "tabs.close",
  "tabs.reopen_closed",
  "panes.split_right",
  "panes.split_down",
  "panes.maximize_toggle",
  "panes.close",
  "navigation.previous_project",
  "navigation.next_session",
  "panes.focus_left",
  "search.open_command_palette",
  "unknown",
  "toString",
  "sessions.create_current_project",
])("does not execute %s", async (actionId) => {
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId, projectId: null }),
  );
  mount();
  await open();
  expect(screen.getByRole("option")).toHaveAttribute("aria-disabled", "true");
  await activate();
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(createSession).not.toHaveBeenCalled();
  expect(getSession).not.toHaveBeenCalled();
});
/** Owner context is resolved before any search request. */
it.each(["/projects/p", "/sessions/s"])("resolves %s context", async (path) => {
  mount(path);
  await open();
  expect(searchUnified).toHaveBeenCalledWith({ query: "", contextProjectId: "p" });
  if (path.startsWith("/projects")) expect(getProject).toHaveBeenCalledWith("p");
  else expect(getSession).toHaveBeenCalledWith("s");
});
/** Context failure leaves global navigation usable. */
it("falls back to global context", async () => {
  vi.mocked(getSession).mockRejectedValue(new Error("private"));
  mount("/sessions/s");
  await open();
  expect(searchUnified).toHaveBeenCalledWith({ query: "", contextProjectId: null });
});
/** Revalidate returned identities and use the existing route owners. */
it.each(["project", "session"] as const)("revalidates %s result", async (kind) => {
  vi.mocked(searchUnified).mockResolvedValue(
    response(
      kind === "project" ? { kind, projectId: "p" } : { kind, projectId: "p", sessionId: "s" },
    ),
  );
  mount();
  await open();
  await activate();
  await waitFor(() =>
    expect(screen.getByTestId("route").textContent).toBe(
      kind === "project" ? "/projects/p" : "/sessions/s",
    ),
  );
});
/** An owner mismatch produces one read refresh rather than opening a substitute. */
it.each(["mismatch", "missing"])("handles %s target", async (mode) => {
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "session", projectId: "p", sessionId: "s" }),
  );
  if (mode === "mismatch") vi.mocked(getSession).mockResolvedValue(detail("other"));
  else
    vi.mocked(getSession).mockRejectedValue(
      new IpcCallError("get_session", { code: "sessionNotFound" }),
    );
  mount();
  await open();
  await activate();
  expect(await screen.findByRole("alert")).toHaveTextContent("This result is no longer available.");
  await waitFor(() => expect(searchUnified).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("route").textContent).toBe("/");
});
/** A contextual session uses only the backend target and returned identity. */
it("creates a session once and navigates to its tool-picker owner", async () => {
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId: "sessions.create_current_project", projectId: "p" }),
  );
  mount();
  await open();
  await activate();
  expect(createSession).toHaveBeenCalledExactlyOnceWith("p");
  await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/sessions/new"));
});
/** Keep a mutation locked across dismissal/reopen and never navigate on late completion. */
it("retains creation lock across reopen", async () => {
  let resolve!: (value: SessionDetailDto) => void;
  vi.mocked(createSession).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId: "sessions.create_current_project", projectId: "p" }),
  );
  mount();
  await open();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await userEvent.click(screen.getByRole("button", { name: "Close search" }));
  await open();
  await activate();
  expect(createSession).toHaveBeenCalledTimes(1);
  await act(async () => resolve(detail("late")));
  expect(screen.getByTestId("route").textContent).toBe("/");
});
/** Known and uncertain creation failures never retry the mutation automatically. */
it.each([null, "projectUnavailable", "runtimeShuttingDown", "projectNotFound"])(
  "handles creation failure %s",
  async (code) => {
    vi.mocked(createSession).mockRejectedValue(
      new IpcCallError("create_session", code ? { code } : null),
    );
    vi.mocked(searchUnified).mockResolvedValue(
      response({ kind: "command", actionId: "sessions.create_current_project", projectId: "p" }),
    );
    mount();
    await open();
    await activate();
    expect(await screen.findByRole("alert")).not.toHaveTextContent("create_session");
    if (!code)
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Check the project sessions before trying again.",
      );
    expect(createSession).toHaveBeenCalledTimes(1);
  },
);
/** Configured capture dispatch works from terminal-like input and consumes the accepted event. */
it("uses the current override without terminal leakage", async () => {
  const action = state.value.snapshot?.actions[0];
  if (!action) throw new Error("fixture");
  action.currentChord = { ...action.currentChord, keyCode: "KeyP" };
  mount();
  const terminal = screen.getByRole("textbox", { name: "Terminal input" });
  terminal.focus();
  const bubble = vi.fn();
  terminal.addEventListener("keydown", bubble);
  fireEvent.keyDown(terminal, { code: "KeyK", key: "k", ctrlKey: true });
  expect(screen.queryByRole("combobox")).toBeNull();
  bubble.mockClear();
  const event = new KeyboardEvent("keydown", {
    code: "KeyP",
    key: "p",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => terminal.dispatchEvent(event));
  await screen.findByRole("combobox");
  expect(event.defaultPrevented).toBe(true);
  expect(bubble).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Close search" }));
  await waitFor(() => expect(terminal).toHaveFocus());
});
/** Provider uncertainty or conflicts never activate a fallback chord; the pill stays usable. */
it.each(["loading", "refreshing", "error", "pending", "conflict", "platform"])(
  "disables keyboard for %s",
  async (mode) => {
    if (mode === "pending") state.value.pending = "set";
    else if (mode === "conflict") {
      const action = state.value.snapshot?.actions[0];
      if (action) action.conflictsWith = ["tabs.create"];
    } else if (mode === "platform") state.value.platform = null;
    else state.value.status = mode as KeyboardShortcutsState["status"];
    mount();
    const event = new KeyboardEvent("keydown", {
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("combobox")).toBeNull();
    if (mode !== "conflict")
      expect(
        screen.getByRole("button", { name: "Search or run a command" }).querySelector("kbd"),
      ).toBeNull();
    await open();
  },
);
/** IME, repeated, handled and extra modifier input remain unconsumed. */
it.each(["repeat", "composition", "handled", "modifier", "altgraph", "modal"])(
  "guards %s keyboard input",
  async (mode) => {
    mount();
    let modal: HTMLDivElement | undefined;
    if (mode === "modal") {
      modal = document.createElement("div");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      document.body.append(modal);
    }
    const event = new KeyboardEvent("keydown", {
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      repeat: mode === "repeat",
      isComposing: mode === "composition",
      shiftKey: mode === "modifier",
    });
    if (mode === "handled") event.preventDefault();
    if (mode === "altgraph")
      Object.defineProperty(event, "getModifierState", { value: () => true });
    act(() => window.dispatchEvent(event));
    expect(screen.queryByRole("combobox")).toBeNull();
    if (mode !== "handled") expect(event.defaultPrevented).toBe(false);
    modal?.remove();
  },
);
/** Route/Quit/hidden lifetimes prevent owner completion from stealing navigation. */
it.each(["route", "quit", "hidden", "unmount"])(
  "abandons late owner navigation on %s",
  async (mode) => {
    let resolve!: (value: SessionDetailDto) => void;
    vi.mocked(getSession).mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    vi.mocked(searchUnified).mockResolvedValue(
      response({ kind: "session", sessionId: "s", projectId: "p" }),
    );
    const view = mount();
    await open();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    if (mode === "route")
      fireEvent.click(screen.getByRole("button", { name: "Other route", hidden: true }));
    else if (mode === "quit") act(() => useQuitStore.setState({ phase: "requesting" }));
    else if (mode === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
    } else view.unmount();
    await act(async () => resolve(detail()));
    if (mode !== "unmount") expect(screen.getByTestId("route").textContent).not.toBe("/sessions/s");
    if (mode === "hidden") Reflect.deleteProperty(document, "hidden");
  },
);

/** Build a local maintenance owner with no native initialization. */
function dataOwner() {
  const owner = createDataManagementState({
    beforeConfirm: async () => () => {},
    onCommitted: async () => {},
    onResetUncertain: async () => {},
    refreshViews: async () => {},
  });
  maintenance.value = owner.getSnapshot();
  return owner;
}

/** A creation that commits after reset cannot route or restore stale palette focus. */
it("retires in-flight session creation on Data reset epoch before render", async () => {
  const owner = dataOwner();
  let resolve!: (value: SessionDetailDto) => void;
  vi.mocked(createSession).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "command", actionId: "sessions.create_current_project", projectId: "p" }),
  );
  mount("/projects/p");
  await open();
  await activate();
  await owner.getSnapshot().acceptCommitted("app_reset");
  await act(async () => resolve(detail("late")));
  expect(screen.getByTestId("route")).toHaveTextContent("/projects/p");
  expect(createSession).toHaveBeenCalledOnce();
});
/** Owner lookups captured before maintenance cannot navigate once their epoch is obsolete. */
it("retires getSession activation on Data import", async () => {
  const owner = dataOwner();
  let resolve!: (value: SessionDetailDto) => void;
  vi.mocked(getSession).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  vi.mocked(searchUnified).mockResolvedValue(
    response({ kind: "session", sessionId: "s", projectId: "p" }),
  );
  mount();
  await open();
  await activate();
  await owner.getSnapshot().acceptCommitted("backup_imported");
  await act(async () => resolve(detail()));
  expect(screen.getByTestId("route").textContent).toBe("/");
});
