import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseTargetDialog } from "./close-target-dialog";
import { createCloseImpact, createTabCloseTarget, createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("CloseTargetDialog", () => {
  // Verify a tab dialog presents backend facts and only confirms after the destructive action.
  it("renders tab copy and confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const target = createTabCloseTarget();
    render(
      <CloseTargetDialog
        pendingClose={{
          target,
          impact: createCloseImpact({
            target,
            runningProcessCount: 1,
            runningProcessLabels: ["codex"],
          }),
          isLastPaneOfTab: false,
        }}
        tabs={[createTabDto()]}
        isPending={false}
        failure={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onRetry={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Close tab “Codex”?" })).toBeInTheDocument();
    expect(screen.getByText("1 running process will be stopped: codex")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close Tab" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
