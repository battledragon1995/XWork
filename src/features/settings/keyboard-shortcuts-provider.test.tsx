import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readAppInfo } from "@/lib/ipc/app-info";
import { getKeyboardShortcuts, setKeyboardShortcut } from "@/lib/ipc/keyboard-shortcuts";
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from "./keyboard-shortcuts-provider";

/** Mock the backend boundary for provider lifetimes. */
vi.mock("@/lib/ipc/keyboard-shortcuts", () => ({
  getKeyboardShortcuts: vi.fn(),
  setKeyboardShortcut: vi.fn(),
  resetKeyboardShortcut: vi.fn(),
  resetAllKeyboardShortcuts: vi.fn(),
}));
/** Prevent OS calls in jsdom. */
vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));
/** Observe public state without relying on implementation internals. */
function Consumer() {
  const state = useKeyboardShortcuts();
  return (
    <>
      <p>Shell remains available</p>
      <p>{state.status}</p>
      <button
        type="button"
        onClick={
          // Explicitly retry initialization from the public contract.
          () => void state.refresh()
        }
      >
        Retry
      </button>
    </>
  );
}
/** Isolate mocks for each mounted lifetime. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readAppInfo).mockResolvedValue({
    osPlatform: "windows",
    osArch: "x64",
    osVersion: "test",
    appVersion: "test",
  });
  vi.mocked(getKeyboardShortcuts).mockResolvedValue({ actions: [] });
});
afterEach(cleanup);
/** StrictMode generations coalesce focus refreshes and release the native listener. */
it("survives StrictMode replay and cleans up focus", async () => {
  const view = render(
    <StrictMode>
      <KeyboardShortcutsProvider>
        <Consumer />
      </KeyboardShortcutsProvider>
    </StrictMode>,
  );
  await screen.findByText("ready");
  const before = vi.mocked(getKeyboardShortcuts).mock.calls.length;
  await act(
    /** Flush pending backend and React updates. */ async () => {
      fireEvent.focus(window);
      fireEvent.focus(window);
    },
  );
  expect(getKeyboardShortcuts).toHaveBeenCalledTimes(before + 1);
  expect(readAppInfo).toHaveBeenCalledTimes(1);
  view.unmount();
  fireEvent.focus(window);
  expect(getKeyboardShortcuts).toHaveBeenCalledTimes(before + 1);
});
/** Failed platform initialization leaves the shell usable and supports retry. */
it("keeps children mounted when startup fails", async () => {
  vi.mocked(readAppInfo).mockRejectedValueOnce(new Error("offline"));
  render(
    <KeyboardShortcutsProvider>
      <Consumer />
    </KeyboardShortcutsProvider>,
  );
  await screen.findByText("error");
  expect(screen.getByText("Shell remains available")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(
    /** Wait for the committed UI state. */ () =>
      expect(screen.getByText("ready")).toBeInTheDocument(),
  );
});
/** The provider keeps an admitted write alive when only the editor route unmounts. */
it("retains a committed assignment after its route consumer unmounts", async () => {
  const chord = { primary: true, alt: false, shift: false, keyCode: "KeyT" };
  const initial = {
    actions: [
      {
        actionId: "tabs.create",
        label: "New tab",
        category: "tabs" as const,
        scope: "application" as const,
        defaultChord: chord,
        currentChord: chord,
        isCustom: false,
        conflictsWith: [],
        isDispatchable: true,
      },
    ],
  };
  vi.mocked(getKeyboardShortcuts).mockResolvedValue(initial);
  const committed = {
    actions: [
      {
        actionId: "tabs.create",
        label: "New tab",
        category: "tabs" as const,
        scope: "application" as const,
        defaultChord: chord,
        currentChord: { ...chord, keyCode: "KeyY" },
        isCustom: true,
        conflictsWith: [],
        isDispatchable: true,
      },
    ],
  };
  let settle!: (value: typeof committed) => void;
  const response = new Promise<typeof committed>(
    // Hold the commit until the editing consumer has left the tree.
    (resolve) => {
      settle = resolve;
    },
  );
  vi.mocked(setKeyboardShortcut).mockReturnValue(response);
  /** Expose the retained chord independently from the editing route. */
  function Observer() {
    const state = useKeyboardShortcuts();
    return <p>{state.snapshot?.actions[0]?.currentChord.keyCode ?? state.status}</p>;
  }
  /** Submit through the public action before this route disappears. */
  function Editor() {
    const state = useKeyboardShortcuts();
    return (
      <button
        type="button"
        onClick={
          // Start an admitted write without awaiting it in the soon-unmounted route.
          () => void state.assign({ actionId: "tabs.create", chord: { ...chord, keyCode: "KeyY" } })
        }
      >
        Assign
      </button>
    );
  }
  const view = render(
    <KeyboardShortcutsProvider>
      <Observer />
      <Editor />
    </KeyboardShortcutsProvider>,
  );
  await screen.findByText("KeyT");
  await act(
    /** Flush pending backend and React updates. */ async () => {
      fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    },
  );
  view.rerender(
    <KeyboardShortcutsProvider>
      <Observer />
    </KeyboardShortcutsProvider>,
  );
  await act(
    /** Flush pending backend and React updates. */ async () => {
      settle(committed);
    },
  );
  expect(screen.getByText("KeyY")).toBeInTheDocument();
});
