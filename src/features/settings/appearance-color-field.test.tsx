// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceColorField } from "./appearance-color-field";

/** Render one field with spied callbacks, so each case asserts what the editor receives. */
function renderField(value = "#cc785c", errorMessage?: string) {
  const onChange = vi.fn();
  const onCommitNow = vi.fn();
  const view = render(
    <AppearanceColorField
      errorMessage={errorMessage}
      label="Accent"
      onChange={onChange}
      onCommitNow={onCommitNow}
      value={value}
    />,
  );
  return { onChange, onCommitNow, view };
}

/** Read the hex text field of the rendered row. */
function hexField(): HTMLInputElement {
  return screen.getByLabelText("Accent") as HTMLInputElement;
}

/** Read the native colour control of the rendered row. */
function picker(): HTMLInputElement {
  return screen.getByLabelText("Accent colour picker") as HTMLInputElement;
}

describe("AppearanceColorField", () => {
  afterEach(() => {
    cleanup();
  });

  // Verify both controls start on the same committed colour and are separately labelled.
  it("synchronizes both controls on the committed colour", () => {
    renderField("#cc785c");

    expect(hexField()).toHaveValue("#cc785c");
    expect(picker()).toHaveValue("#cc785c");
  });

  // Verify a valid typed colour previews immediately through the editor callback.
  it("reports a valid typed colour", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#123456");

    expect(onChange).toHaveBeenLastCalledWith("#123456");
    expect(hexField()).toHaveValue("#123456");
  });

  // Verify a pasted uppercase colour is accepted and shown to the picker in lowercase.
  it("accepts an uppercase colour", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField("#cc785c");

    await user.clear(hexField());
    await user.paste("#AABBCC");

    expect(onChange).toHaveBeenLastCalledWith("#AABBCC");
    expect(picker()).toHaveValue("#aabbcc");
  });

  // Verify incomplete text stays in the field with no error until the user leaves it.
  it("keeps incomplete text without an error", async () => {
    const user = userEvent.setup();
    renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#12");

    expect(hexField()).toHaveValue("#12");
    expect(screen.queryByText("Use a #rrggbb colour.")).not.toBeInTheDocument();
  });

  // Verify every rejected notation is reported once the field loses focus.
  it.each(["#abc", "red", "rgb(1, 2, 3)"])("shows a format error for %s on blur", async (text) => {
    const user = userEvent.setup();
    renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), text);
    await user.tab();

    expect(screen.getByText("Use a #rrggbb colour.")).toBeInTheDocument();
    expect(hexField()).toHaveValue(text);
  });

  // Verify the row error is announced through the field it belongs to.
  it("associates its error with the input", async () => {
    const user = userEvent.setup();
    renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#abc");
    await user.tab();

    const errorId = hexField().getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    expect(hexField()).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(errorId ?? "")).toHaveTextContent("Use a #rrggbb colour.");
  });

  // Verify a backend error supplied by the page is shown on the row it belongs to.
  it("shows the supplied error message", () => {
    renderField("#cc785c", "XWork couldn't save that colour.");

    expect(screen.getByText("XWork couldn't save that colour.")).toBeInTheDocument();
    expect(hexField()).toHaveAttribute("aria-invalid", "true");
  });

  // Verify dragging the native picker previews continuously without persisting each step.
  it("previews every native picker step", () => {
    const { onChange, onCommitNow } = renderField("#cc785c");

    fireEvent.input(picker(), { target: { value: "#112233" } });
    fireEvent.input(picker(), { target: { value: "#445566" } });

    expect(onChange).toHaveBeenNthCalledWith(1, "#112233");
    expect(onChange).toHaveBeenNthCalledWith(2, "#445566");
    expect(onCommitNow).not.toHaveBeenCalled();
    expect(hexField()).toHaveValue("#445566");
  });

  // Verify closing the native colour dialog persists the chosen colour immediately.
  it("persists when the native picker closes", () => {
    const { onCommitNow } = renderField("#cc785c");

    fireEvent.input(picker(), { target: { value: "#112233" } });
    fireEvent.change(picker(), { target: { value: "#112233" } });

    expect(onCommitNow).toHaveBeenCalledOnce();
  });

  // Verify Enter confirms a valid colour and persists it without waiting for the debounce.
  it("commits immediately on Enter", async () => {
    const user = userEvent.setup();
    const { onChange, onCommitNow } = renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#AABBCC{Enter}");

    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
    expect(onCommitNow).toHaveBeenCalledOnce();
    expect(hexField()).toHaveValue("#aabbcc");
  });

  // Verify Enter on malformed text discloses the error instead of persisting it.
  it("does not commit malformed text on Enter", async () => {
    const user = userEvent.setup();
    const { onCommitNow } = renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#abc{Enter}");

    expect(onCommitNow).not.toHaveBeenCalled();
    expect(screen.getByText("Use a #rrggbb colour.")).toBeInTheDocument();
  });

  // Verify Escape returns the row and the preview to the current committed colour.
  it("reverts to the committed colour on Escape", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#abc");
    await user.keyboard("{Escape}");

    expect(hexField()).toHaveValue("#cc785c");
    expect(onChange).toHaveBeenLastCalledWith("#cc785c");
    expect(screen.queryByText("Use a #rrggbb colour.")).not.toBeInTheDocument();
  });

  // Verify a reconciled backend value replaces stale raw text and clears a stale error.
  it("adopts a new committed value after reconciliation", async () => {
    const user = userEvent.setup();
    const { view } = renderField("#cc785c");

    await user.clear(hexField());
    await user.type(hexField(), "#abc");
    await user.tab();
    expect(screen.getByText("Use a #rrggbb colour.")).toBeInTheDocument();

    view.rerender(
      <AppearanceColorField
        label="Accent"
        onChange={vi.fn()}
        onCommitNow={vi.fn()}
        value="#a95f4a"
      />,
    );

    expect(hexField()).toHaveValue("#a95f4a");
    expect(screen.queryByText("Use a #rrggbb colour.")).not.toBeInTheDocument();
  });
});
