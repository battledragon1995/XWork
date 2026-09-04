import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTab } from "./session-tab";
import { createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("SessionTab", () => {
  // Verify selected semantics, full-name title, rename, and target-specific close label.
  it("renders and activates one selected tab", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <DndContext>
        <SessionTab
          tab={createTabDto({ name: "Tên tab rất dài" })}
          isSelected
          isBusy={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onRename={onRename}
          onNavigate={vi.fn()}
        />
      </DndContext>,
    );
    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("title", "Tên tab rất dài");
    expect(screen.getByRole("button", { name: "Close tab “Tên tab rất dài”" })).toBeInTheDocument();
    await user.dblClick(tab);
    expect(onRename).toHaveBeenCalled();
  });
});
