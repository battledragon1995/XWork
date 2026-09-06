import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KeyboardShortcutActionDto } from "@/bindings/keyboard-shortcuts";
import type { KeyboardShortcutsState } from "./keyboard-shortcuts-state";
import { ShortcutRecorderDialog } from "./shortcut-recorder-dialog";

const chord = { primary: true, alt: false, shift: false, keyCode: "KeyT" };
const action: KeyboardShortcutActionDto = {
  actionId: "tabs.create",
  label: "New tab",
  category: "tabs",
  scope: "application",
  currentChord: chord,
  defaultChord: chord,
  isCustom: false,
  conflictsWith: [],
  isDispatchable: true,
};
let state: KeyboardShortcutsState;
/** Inject the public state contract to isolate recorder-only behavior. */
vi.mock("./keyboard-shortcuts-provider", () => ({
  /** Expose the current injected provider state. */ useKeyboardShortcuts: () => state,
}));
/** Reset each local candidate and mutation spy. */
beforeEach(() => {
  state = {
    snapshot: { actions: [action] },
    platform: "windows",
    status: "ready",
    pending: null,
    error: null,
    assign: vi.fn(/** Resolve an isolated backend response. */ async () => true),
    resetOne: vi.fn(),
    resetAll: vi.fn(),
    refresh: vi.fn(),
  };
});
afterEach(cleanup);
/** Mount a recorder with independently observable close callbacks. */
function mount() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const props = { action, onClose, onSaved, onClosed: vi.fn() };
  const view = render(<ShortcutRecorderDialog {...props} />);
  return { ...view, props, recorder: screen.getByRole("button", { name: "Press a shortcut" }) };
}
/** Tab traverses controls and ignored IME events preserve the last candidate. */
it("preserves drafts for ignored input and allows keyboard traversal", async () => {
  const user = userEvent.setup();
  const { recorder } = mount();
  expect(recorder).toHaveFocus();
  fireEvent.keyDown(recorder, { code: "KeyY", ctrlKey: true });
  for (const extra of [
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { metaKey: true },
  ])
    fireEvent.keyDown(recorder, { code: "KeyZ", ctrlKey: true, ...extra });
  fireEvent.keyDown(recorder, { code: "ShiftLeft", shiftKey: true });
  expect(recorder).toHaveTextContent("Ctrl Y");
  await user.tab();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.keyDown(recorder, { code: "KeyZ", ctrlKey: true });
  expect(recorder).toHaveTextContent("Ctrl Y");
  await user.tab();
  expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(state.assign).toHaveBeenCalledWith({
    actionId: "tabs.create",
    chord: { ...chord, keyCode: "KeyY" },
  });
});
/** Conflict previews are informative and still allow explicit Save. */
it("allows a conflicting candidate without mutating before Save", async () => {
  state.snapshot = { actions: [action, { ...action, actionId: "tabs.close", label: "Close tab" }] };
  const { recorder } = mount();
  fireEvent.keyDown(recorder, { code: "KeyT", ctrlKey: true });
  expect(screen.getByText(/Conflicts with Close tab/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(state.assign).not.toHaveBeenCalled();
});
/** Plain Escape cancels, modified Escape is recorded, and pending commands cannot be dismissed. */
it("guards Escape and pending actions", () => {
  const view = mount();
  fireEvent.keyDown(view.recorder, { key: "Escape", code: "Escape", ctrlKey: true });
  expect(view.recorder).toHaveTextContent("Ctrl Escape");
  expect(view.props.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(view.recorder, { key: "Escape", code: "Escape" });
  expect(view.props.onClose).toHaveBeenCalledOnce();
  state = { ...state, pending: "set" };
  view.rerender(<ShortcutRecorderDialog {...view.props} />);
  fireEvent.keyDown(view.recorder, { key: "Escape", code: "Escape" });
  expect(view.props.onClose).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
});
/** Unsupported and modifier-free keys show actionable validation and prevent Save. */
it("validates unsupported and reserved candidates", () => {
  const { recorder } = mount();
  for (const [code, extras, message] of [
    ["KeyA", {}, "Use Ctrl or Alt, or a function key."],
    ["Numpad1", { ctrlKey: true }, "This key is not supported."],
    ["F4", { altKey: true }, "This shortcut is reserved by the operating system."],
  ] as const) {
    fireEvent.keyDown(recorder, { code, ...extras });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  }
});
