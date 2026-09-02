import { useEffect, useRef } from "react";
import { MAX_SIDEBAR_WIDTH_PX, MIN_SIDEBAR_WIDTH_PX, useShellStore } from "./shell-store";

/** Width change of one arrow-key press, the keyboard equivalent of a small drag. */
const KEYBOARD_STEP_PX = 16;

// Let the user change the sidebar width by dragging the seam or, equivalently, with the
// keyboard. The published width is always the clamped one, so `aria-valuenow` can never
// disagree with the width the layout actually uses.
export function SidebarResizeHandle() {
  const sidebarWidthPx = useShellStore((state) => state.sidebarWidthPx);
  const isSidebarCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const setSidebarWidthPx = useShellStore((state) => state.setSidebarWidthPx);
  const handleRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  // Collapsing while a drag is still active would leave the pointer captured by an element
  // that is about to unmount, so the drag is ended first and the last width is kept.
  useEffect(() => {
    if (!isSidebarCollapsed) {
      return;
    }

    const pointerId = activePointerIdRef.current;
    if (pointerId === null) {
      return;
    }

    activePointerIdRef.current = null;
    if (handleRef.current?.hasPointerCapture(pointerId)) {
      handleRef.current.releasePointerCapture(pointerId);
    }
  }, [isSidebarCollapsed]);

  // Stop tracking the pointer that started the current drag, if there is one.
  function releasePointer() {
    const pointerId = activePointerIdRef.current;
    if (pointerId === null) {
      return;
    }

    activePointerIdRef.current = null;
    if (handleRef.current?.hasPointerCapture(pointerId)) {
      handleRef.current.releasePointerCapture(pointerId);
    }
  }

  // Begin a drag and keep receiving moves even when the pointer leaves the thin seam.
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  // Track the pointer. The sidebar starts at the left window edge, so the pointer position
  // is the requested width before clamping.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    setSidebarWidthPx(event.clientX);
  }

  // End the drag on release or cancellation and keep whatever width was reached.
  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    releasePointer();
  }

  // Offer the documented keyboard equivalent of dragging the seam.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = resolveKeyboardWidth(event.key, sidebarWidthPx);
    if (next === null) {
      return;
    }

    event.preventDefault();
    setSidebarWidthPx(next);
  }

  return (
    // This is the focusable window splitter pattern: a separator with a value and key handling.
    // biome-ignore lint/a11y/useSemanticElements: an hr cannot carry that pattern.
    <div
      ref={handleRef}
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuenow={sidebarWidthPx}
      aria-valuemin={MIN_SIDEBAR_WIDTH_PX}
      aria-valuemax={MAX_SIDEBAR_WIDTH_PX}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className="absolute inset-y-0 z-10 -ml-[3px] w-[7px] cursor-col-resize outline-none focus-visible:bg-brand/40"
      style={{ left: sidebarWidthPx }}
    />
  );
}

// Map one key to the width it requests, or null when the key is not a resize key.
function resolveKeyboardWidth(key: string, currentWidthPx: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return currentWidthPx - KEYBOARD_STEP_PX;
    case "ArrowRight":
      return currentWidthPx + KEYBOARD_STEP_PX;
    case "Home":
      return MIN_SIDEBAR_WIDTH_PX;
    case "End":
      return MAX_SIDEBAR_WIDTH_PX;
    default:
      return null;
  }
}
