import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { PaneSplitHandle } from "./pane-split-handle";

vi.mock("react-resizable-panels", () => ({
  // Replace only the context-bound surface so the handle's keyboard contract stays isolated.
  Separator: ({
    disabled: _disabled,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) => (
    <hr tabIndex={0} aria-valuenow={50} {...props} />
  ),
}));

afterEach(cleanup);

describe("PaneSplitHandle", () => {
  // Verify a completed pointer resize commits the latest ratio exactly once.
  it("commits a completed pointer ratio", () => {
    const groupRef = {
      current: { getLayout: vi.fn(), setLayout: vi.fn() } as GroupImperativeHandle,
    };
    const onCommit = vi.fn();
    render(
      <PaneSplitHandle
        splitId="split-1"
        axis="vertical"
        ratioBasisPoints={5000}
        currentRatioBasisPoints={6500}
        firstPanelId="first"
        secondPanelId="second"
        groupRef={groupRef}
        disabled={false}
        onCommit={onCommit}
      />,
    );
    const separator = screen.getByRole("separator", { name: "Resize panes left and right" });
    fireEvent.pointerDown(separator, { pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(6500);
  });

  // Verify keyboard resize updates the group and commits once on Enter.
  it("commits a keyboard ratio", () => {
    const setLayout = vi.fn((layout: Record<string, number>) => layout);
    const groupRef = { current: { getLayout: vi.fn(), setLayout } as GroupImperativeHandle };
    const onCommit = vi.fn();
    render(
      <PaneSplitHandle
        splitId="split-1"
        axis="vertical"
        ratioBasisPoints={5000}
        currentRatioBasisPoints={5000}
        firstPanelId="first"
        secondPanelId="second"
        groupRef={groupRef}
        disabled={false}
        onCommit={onCommit}
      />,
    );
    const separator = screen.getByRole("separator", { name: "Resize panes left and right" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(setLayout).toHaveBeenCalledWith({ first: 52, second: 48 });
    expect(onCommit).toHaveBeenCalledWith(5200);
  });

  // Verify Escape restores the latest backend ratio without committing.
  it("restores on Escape", () => {
    const setLayout = vi.fn((layout: Record<string, number>) => layout);
    const groupRef = { current: { getLayout: vi.fn(), setLayout } as GroupImperativeHandle };
    const onCommit = vi.fn();
    render(
      <PaneSplitHandle
        splitId="split-1"
        axis="horizontal"
        ratioBasisPoints={4000}
        currentRatioBasisPoints={6000}
        firstPanelId="first"
        secondPanelId="second"
        groupRef={groupRef}
        disabled={false}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize panes up and down" }), {
      key: "Escape",
    });
    expect(setLayout).toHaveBeenCalledWith({ first: 40, second: 60 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
