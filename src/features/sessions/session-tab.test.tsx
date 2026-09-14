import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTab } from "./session-tab";
import { createPaneDto, createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("SessionTab", () => {
  // File titles replace only the untouched default tab label.
  it.each([
    ["New Tab", "package.json"],
    ["My files", "My files"],
  ])("labels %s as %s", (name, title) => {
    const pane = createPaneDto({
      content: { kind: "file", fileHandleId: "file-fixture", title: "package.json" },
    });
    render(
      <DndContext>
        <SessionTab
          tab={createTabDto({ name, layout: { kind: "pane", pane } })}
          isSelected
          isBusy={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onRename={vi.fn()}
          onNavigate={vi.fn()}
        />
      </DndContext>,
    );
    expect(screen.getByRole("tab")).toHaveAccessibleName(title);
    expect(screen.getByRole("button", { name: `Close tab “${title}”` })).toBeInTheDocument();
  });

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
