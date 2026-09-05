import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TerminalFindBar } from "./terminal-find-bar";

/** Verifies query entry, wrapped navigation controls and Escape closure. */
it("exposes complete find controls to keyboard users", async () => {
  const user = userEvent.setup();
  const onQuery = vi.fn();
  const onMove = vi.fn();
  const onClose = vi.fn();
  render(
    <TerminalFindBar
      query="term"
      searching={false}
      matchCount={2}
      activeMatch={0}
      onQuery={onQuery}
      onMove={onMove}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  await user.click(screen.getByRole("button", { name: "Next match" }));
  expect(onMove).toHaveBeenCalledWith("next");
  await user.type(screen.getByRole("textbox"), "x");
  expect(onQuery).toHaveBeenLastCalledWith("termx");
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});
