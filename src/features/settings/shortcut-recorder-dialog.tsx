import { useRef, useState } from "react";
import type { KeyboardShortcutActionDto, ShortcutChordDto } from "@/bindings/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  equalShortcut,
  formatShortcut,
  ignoreShortcutEvent,
  normalizeShortcut,
  validateShortcut,
} from "@/lib/utils/keyboard-shortcuts";
import { useKeyboardShortcuts } from "./keyboard-shortcuts-provider";
import { shortcutErrorCopy } from "./keyboard-shortcuts-state";

/** Record a local candidate and persist it only after explicit Save. */
export function ShortcutRecorderDialog(props: {
  action: KeyboardShortcutActionDto;
  onClose(): void;
  onSaved(): void;
  onClosed(): void;
}) {
  const state = useKeyboardShortcuts();
  const [candidate, setCandidate] = useState<ShortcutChordDto | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const recorder = useRef<HTMLButtonElement>(null);
  const pending = state.pending !== null;
  const ready = state.status === "ready" && state.platform !== null && !pending;
  const platform = state.platform;
  const conflicts =
    candidate === null
      ? []
      : (state.snapshot?.actions.filter(
          // Preview against the entire committed catalog, including hidden rows.
          (action) =>
            action.actionId !== props.action.actionId &&
            equalShortcut(candidate, action.currentChord),
        ) ?? []);
  /** Consume only events delivered to the focused recording surface. */
  function record(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.currentTarget !== document.activeElement || !ready || platform === null) return;
    const native = event.nativeEvent;
    if (ignoreShortcutEvent(native, platform)) return;
    if (
      (native.code === "Tab" && !native.ctrlKey && !native.altKey && !native.metaKey) ||
      (native.code === "Escape" &&
        !native.ctrlKey &&
        !native.altKey &&
        !native.metaKey &&
        !native.shiftKey)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const chord = normalizeShortcut(native, platform);
    setValidation(
      validateShortcut(
        {
          primary: platform === "windows" ? native.ctrlKey : native.metaKey,
          alt: native.altKey,
          shift: native.shiftKey,
          keyCode: native.code,
        },
        platform,
      ),
    );
    setCandidate(chord);
  }
  /** Close only once the backend acknowledges this candidate. */
  async function save() {
    if (
      candidate !== null &&
      (await state.assign({ actionId: props.action.actionId, chord: candidate }))
    )
      props.onSaved();
  }
  return (
    <Dialog
      open
      onOpenChange={
        // Keep the dialog open while a command is pending.
        (open) => {
          if (!open && !pending) props.onClose();
        }
      }
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={
          // Outside clicks never discard a draft.
          (event) => event.preventDefault()
        }
        onOpenAutoFocus={
          // Start keyboard recording immediately after opening.
          (event) => {
            event.preventDefault();
            recorder.current?.focus();
          }
        }
        onCloseAutoFocus={
          // Restore the durable row opener after the portal closes.
          (event) => {
            event.preventDefault();
            props.onClosed();
          }
        }
        onEscapeKeyDown={
          // Modified Escape belongs to recording, while plain Escape cancels.
          (event) => {
            if (pending || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
              event.preventDefault();
          }
        }
      >
        <DialogTitle>Change shortcut</DialogTitle>
        <DialogDescription>{props.action.label}</DialogDescription>
        {platform !== null && (
          <p className="text-sm">
            Current: {formatShortcut(props.action.currentChord, platform)}
            <br />
            Default: {formatShortcut(props.action.defaultChord, platform)}
          </p>
        )}
        <button
          ref={recorder}
          type="button"
          aria-label="Press a shortcut"
          aria-describedby="shortcut-record-help"
          className="rounded-md border border-hairline p-5 text-center focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={record}
          aria-disabled={!ready}
        >
          {candidate !== null && platform !== null
            ? formatShortcut(candidate, platform)
            : "Press a shortcut"}
        </button>
        <p id="shortcut-record-help" className="text-sm text-muted">
          Press a shortcut, then choose Save. Press Escape to cancel.
        </p>
        {validation !== null && <p role="alert">{validation}</p>}
        {conflicts.length > 0 && (
          <p role="status">
            Conflicts with{" "}
            {conflicts
              .map(
                // Name all candidate conflicts in catalog order.
                (action) => action.label,
              )
              .join(", ")}
            . These shortcuts are inactive until the conflict is resolved.
          </p>
        )}
        {state.error !== null && <p role="alert">{shortcutErrorCopy(state.error, platform)}</p>}
        {state.status === "error" && (
          <Button
            variant="outline"
            onClick={
              // Reconcile an uncertain write without resubmitting it.
              () => void state.refresh()
            }
          >
            Try again
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || candidate === null}
            onClick={
              // Persist only explicit confirmation.
              () => void save()
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
