import { Copy, Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import type { AppLifecycleError } from "@/bindings/app-lifecycle";
import { HighlightItem } from "@/components/animate-ui/primitives/effects/highlight";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  hideMainWindow,
  minimizeMainWindow,
  toggleMainWindowMaximized,
} from "@/lib/ipc/app-lifecycle";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { useShellStore, type WindowControl } from "./shell-store";

/** Recovery copy for the one window failure the user can retry by clicking again. */
const RECOVERABLE_MESSAGE: Record<WindowControl, string> = {
  minimize: "Couldn't minimize the window. Try again.",
  maximize: "Couldn't change the window size. Try again.",
  close: "Couldn't hide the window to the tray. Try again.",
};

// Read the failure code out of a rejection. Anything the wrapper could not tag becomes
// `"unknown"`, which the shell treats as an integration failure rather than a retryable one.
function toFailureCode(rejection: unknown): AppLifecycleError["code"] | "unknown" {
  if (rejection instanceof IpcCallError && rejection.payload !== null) {
    return (rejection.payload as AppLifecycleError).code;
  }

  return "unknown";
}

/**
 * Run one window command and record its outcome. A success clears any message left by an
 * earlier attempt, so the live region never describes a state the user already recovered from.
 */
export async function runWindowCommand(
  control: WindowControl,
  command: () => Promise<void>,
): Promise<void> {
  const { setWindowControlFailure } = useShellStore.getState();

  try {
    await command();
    setWindowControlFailure(null);
  } catch (rejection) {
    setWindowControlFailure({ control, code: toFailureCode(rejection) });
  }
}

/**
 * Toggle the native maximized state. Both entry points — the button and a double click on the
 * drag region — go through here, so `isMaximized` only ever follows the value the backend
 * actually returned.
 */
export async function toggleMaximized(): Promise<void> {
  const { setMaximized, setWindowControlFailure } = useShellStore.getState();

  try {
    setMaximized(await toggleMainWindowMaximized());
    setWindowControlFailure(null);
  } catch (rejection) {
    setWindowControlFailure({ control: "maximize", code: toFailureCode(rejection) });
  }
}

// Render the three custom window actions and the polite status line for a retryable failure.
export function WindowControls() {
  const isMaximized = useShellStore((state) => state.isMaximized);
  const failure = useShellStore((state) => state.windowControlFailure);
  const maximizeLabel = isMaximized ? "Restore" : "Maximize";
  const MaximizeIcon = isMaximized ? Copy : Square;
  const recoverable = failure?.code === "window_operation_failed" ? failure : null;

  return (
    <div className="relative flex h-10 items-center">
      <WindowControlButton
        label="Minimize"
        onClick={() => void runWindowCommand("minimize", minimizeMainWindow)}
      >
        <Minus aria-hidden="true" className="size-3.5" />
      </WindowControlButton>
      <WindowControlButton label={maximizeLabel} onClick={() => void toggleMaximized()}>
        <MaximizeIcon aria-hidden="true" className="size-3" />
      </WindowControlButton>
      <WindowControlButton
        label="Close (hides to tray)"
        isClose
        onClick={() => void runWindowCommand("close", hideMainWindow)}
      >
        <X aria-hidden="true" className="size-3.5" />
      </WindowControlButton>

      {recoverable !== null && (
        <p
          role="status"
          aria-live="polite"
          className="absolute top-full right-0 z-20 mt-1 rounded-sm bg-canvas px-2.5 py-1.5 text-xs whitespace-nowrap text-error shadow-sm"
        >
          {RECOVERABLE_MESSAGE[recoverable.control]}
        </p>
      )}
    </div>
  );
}

// Render one icon-only window action with a matching accessible name and tooltip.
function WindowControlButton(props: {
  label: string;
  isClose?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <HighlightItem asChild activeClassName={props.isClose ? "bg-error" : "bg-surface-card"}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={props.label}
            onClick={props.onClick}
            className={
              props.isClose
                ? "relative z-[1] h-10 w-11 rounded-none text-body data-[active=true]:text-on-primary [&:not([data-highlight])]:hover:bg-error [&:not([data-highlight])]:hover:text-on-primary active:bg-error active:text-on-primary"
                : "relative z-[1] h-10 w-11 rounded-none text-body [&:not([data-highlight])]:hover:bg-surface-card active:bg-cream-strong"
            }
          >
            {props.children}
          </Button>
        </TooltipTrigger>
      </HighlightItem>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}
