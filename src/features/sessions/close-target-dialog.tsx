import { TriangleAlert } from "lucide-react";
import type { TabDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildCloseImpactFacts,
  CLOSE_LAST_PANE_DESCRIPTION,
  CLOSE_PANE_DESCRIPTION,
  CLOSE_TAB_DESCRIPTION,
  type SessionsFailure,
} from "@/lib/utils/session-copy";
import type { PendingClose } from "./use-workspace-mutations";

/** Confirm an inspected tab or pane close using only backend-measured facts. */
export function CloseTargetDialog(props: {
  pendingClose: PendingClose | null;
  tabs: readonly TabDto[];
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onConfirm(): void;
  onRetry(): void;
  onClosed(): void;
}) {
  const close = props.pendingClose;
  if (close === null) return <Dialog open={false} />;
  const isTab = close.target.kind === "tab";
  const targetTabId = close.target.kind === "tab" ? close.target.tabId : null;
  const tabName =
    targetTabId === null ? null : (props.tabs.find((tab) => tab.id === targetTabId)?.name ?? "Tab");
  const facts = buildCloseImpactFacts(close.impact);
  const title = isTab ? `Close tab “${tabName}”?` : "Close this pane?";
  const description = isTab
    ? CLOSE_TAB_DESCRIPTION
    : close.isLastPaneOfTab
      ? CLOSE_LAST_PANE_DESCRIPTION
      : CLOSE_PANE_DESCRIPTION;
  const action = isTab ? "Close Tab" : "Close Pane";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.isPending) props.onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {facts.length > 0 && (
          <ul className="grid gap-2 rounded-md bg-surface-card px-3.5 py-3 text-[13px] text-body-strong">
            {facts.map((fact) => (
              <li key={fact} className="flex gap-2">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-warn-ink"
                />
                {fact}
              </li>
            ))}
          </ul>
        )}
        {props.failure !== null && (
          <p role="alert" className="text-[13px] text-error">
            {props.failure.message}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.isPending}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={props.isPending || props.failure?.code === "closeInProgress"}
            onClick={props.failure?.canRetry ? props.onRetry : props.onConfirm}
          >
            {props.isPending ? "Closing…" : props.failure?.canRetry ? "Try again" : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
