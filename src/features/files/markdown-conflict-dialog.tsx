import { useRef } from "react";
import type { ExternalFileResolutionDto, FileHandleDto } from "@/bindings/files/files";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
/** Offer exactly two explicit conflict decisions while Escape only dismisses. */
export function MarkdownConflictDialog(props: {
  handle: FileHandleDto;
  open: boolean;
  pending: boolean;
  failure: string | null;
  onClose(): void;
  onResolve(resolution: ExternalFileResolutionDto): void;
}) {
  const previousOpen = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (props.open && !previousOpen.current)
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousOpen.current = props.open;
  const state = props.handle.state;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{props.handle.name} changed on disk</DialogTitle>
          <DialogDescription>
            Your version has {props.handle.editCount} edits. Choose which version to keep.
          </DialogDescription>
        </DialogHeader>
        {state.kind === "externalConflict" && (
          <p>
            Disk modified:{" "}
            {state.external.modifiedAtMs === null
              ? "Unknown"
              : new Date(Number(state.external.modifiedAtMs)).toLocaleString()}
            . Size: {String(state.external.byteSize)} bytes.
          </p>
        )}
        {props.failure && <p role="alert">{props.failure}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={props.pending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onResolve("reloadFromDisk")}
          >
            Reload from disk
          </Button>
          <Button disabled={props.pending} onClick={() => props.onResolve("keepMine")}>
            Keep my version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
