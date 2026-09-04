import { useEffect, useRef } from "react";
import { Separator, type GroupImperativeHandle } from "react-resizable-panels";
import type { SplitAxisDto } from "@/bindings/sessions/sessions";
import { cn } from "@/lib/utils/cn";
import {
  clampRatioBasisPoints,
  MAX_RATIO_BASIS_POINTS,
  MIN_RATIO_BASIS_POINTS,
  percentToRatioBasisPoints,
  ratioToPercent,
} from "./session-layout";

/** Time keyboard resizing may remain idle before its single commit. */
const KEYBOARD_SETTLE_MS = 400;

/** Imperative values one split handle needs from its owning Group. */
export interface PaneSplitHandleProps {
  splitId: string;
  axis: SplitAxisDto;
  ratioBasisPoints: number;
  currentRatioBasisPoints: number;
  firstPanelId: string;
  secondPanelId: string;
  groupRef: React.RefObject<GroupImperativeHandle | null>;
  disabled: boolean;
  onCommit(ratioBasisPoints: number): void;
  onInteractionChange?(isActive: boolean): void;
}

/** Render and coordinate one focusable separator without owning browser persistence. */
export function PaneSplitHandle(props: PaneSplitHandleProps) {
  const isPointerActive = useRef(false);
  const latestRatio = useRef(props.currentRatioBasisPoints);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRatio.current = props.currentRatioBasisPoints;

  /** Restore the last backend ratio through the v4 imperative group API. */
  const restore = (): void => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    isPointerActive.current = false;
    props.onInteractionChange?.(false);
    const percent = ratioToPercent(props.ratioBasisPoints);
    props.groupRef.current?.setLayout({
      [props.firstPanelId]: percent,
      [props.secondPanelId]: 100 - percent,
    });
  };

  /** Commit the current visual ratio once for the completed interaction. */
  const commit = (): void => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    isPointerActive.current = false;
    props.onCommit(clampRatioBasisPoints(latestRatio.current));
    props.onInteractionChange?.(false);
  };

  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    };
  }, []);

  /** Finish a pointer drag at the ratio most recently reported by the Group. */
  const handlePointerUp = (): void => {
    if (!isPointerActive.current) return;
    isPointerActive.current = false;
    commit();
  };

  /** Implement the specified integer keyboard steps and delayed single commit. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (props.disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      restore();
      return;
    }

    const decrement =
      props.axis === "vertical" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increment =
      props.axis === "vertical" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    let next: number | null = null;
    if (decrement) next = latestRatio.current - 200;
    else if (increment) next = latestRatio.current + 200;
    else if (event.key === "Home") next = MIN_RATIO_BASIS_POINTS;
    else if (event.key === "End") next = MAX_RATIO_BASIS_POINTS;
    else if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (next === null) return;

    event.preventDefault();
    props.onInteractionChange?.(true);
    const clamped = clampRatioBasisPoints(next);
    latestRatio.current = clamped;
    const percent = ratioToPercent(clamped);
    props.groupRef.current?.setLayout({
      [props.firstPanelId]: percent,
      [props.secondPanelId]: 100 - percent,
    });
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(commit, KEYBOARD_SETTLE_MS);
  };

  return (
    <Separator
      id={`${props.splitId}-separator`}
      aria-label={
        props.axis === "vertical" ? "Resize panes left and right" : "Resize panes up and down"
      }
      disabled={props.disabled}
      className={cn(
        "z-10 shrink-0 bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.axis === "vertical" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
        props.disabled && "invisible pointer-events-none",
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        isPointerActive.current = true;
        props.onInteractionChange?.(true);
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={restore}
      onBlur={() => {
        if (settleTimer.current !== null) commit();
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

/** Convert a Group layout entry to the exact boundary ratio. */
export function ratioFromGroupLayout(layout: Record<string, number>, firstPanelId: string): number {
  return percentToRatioBasisPoints(layout[firstPanelId] ?? 50);
}
