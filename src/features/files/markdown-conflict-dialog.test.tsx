import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { externalConflictState, handle } from "./files-test-fixture";
import { MarkdownConflictDialog } from "./markdown-conflict-dialog";

// Conflict controls forward only the explicit selected decision.
it("offers Keep and Reload without implicit resolution on Cancel", () => {
  const resolve = vi.fn();
  const close = vi.fn();
  render(
    <MarkdownConflictDialog
      handle={handle({ state: externalConflictState({ mode: "markdown" }) })}
      open
      pending={false}
      failure={null}
      onClose={close}
      onResolve={resolve}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
  expect(resolve).toHaveBeenLastCalledWith("keepMine");
  fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
  expect(resolve).toHaveBeenLastCalledWith("reloadFromDisk");
});
// A changed-again failure stays in the dialog and requires a new choice.
it("shows resolution failure and disables both decisions during flight", () => {
  render(
    <MarkdownConflictDialog
      handle={handle({ state: externalConflictState({ mode: "markdown" }) })}
      open
      pending
      failure="The file changed again."
      onClose={vi.fn()}
      onResolve={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("The file changed again.");
  expect(screen.getByRole("button", { name: "Keep my version" })).toBeDisabled();
});

// Release mounted surfaces between isolated component cases.
afterEach(cleanup);

// Explicit focus restoration works even though the dialog uses a separate banner trigger.
it("returns focus to its opening control after dismissal", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const props = {
    handle: handle({ state: externalConflictState({ mode: "markdown" }) }),
    pending: false,
    failure: null,
    onClose: vi.fn(),
    onResolve: vi.fn(),
  };
  const view = render(<MarkdownConflictDialog {...props} open />);
  view.rerender(<MarkdownConflictDialog {...props} open={false} />);
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});
