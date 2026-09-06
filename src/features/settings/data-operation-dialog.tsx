import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { backupDate, dataErrorCopy } from "./data-error-copy";
import { useDataManagement } from "./data-management-provider";

/** Render backend preview numbers without inferring actual applied changes. */
export function DataOperationDialog() {
  const data = useDataManagement();
  const cancel = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef(data.preview);
  const open = data.preview !== null && (data.phase === "preview" || data.phase === "applying");
  const reset = data.operation === "reset";
  const applying = data.phase === "applying";
  useEffect(
    /** Move focus to the changed summary so reconfirmation is an explicit new action. */ () => {
      if (
        previous.current !== data.preview &&
        data.failure?.payload?.code === "import_preview_changed"
      )
        summary.current?.focus();
      previous.current = data.preview;
    },
    [data.preview, data.failure],
  );
  return (
    <Dialog
      open={open}
      onOpenChange={
        /** Cancel only before apply. */ (next) => {
          if (!next && !applying) void data.cancel();
        }
      }
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[560px]"
        aria-busy={applying}
        onOpenAutoFocus={
          /** Prefer the safe action for both destructive and import previews. */ (event) => {
            event.preventDefault();
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            cancel.current?.focus();
          }
        }
        onCloseAutoFocus={
          /** Never restore a deleted, hidden or maintenance-retired opener. */ (event) => {
            event.preventDefault();
            if (
              !document.hidden &&
              (data.getCurrent().phase === "idle" || data.getCurrent().phase === "cancelling") &&
              !data.getCurrent().message &&
              opener.current?.isConnected
            )
              opener.current.focus();
          }
        }
        onEscapeKeyDown={
          /** Applying cannot be dismissed. */ (event) => {
            if (applying) event.preventDefault();
          }
        }
        onInteractOutside={
          /** Applying retains modal focus. */ (event) => {
            if (applying) event.preventDefault();
          }
        }
      >
        <DialogTitle>{reset ? "Reset XWork?" : "Import backup?"}</DialogTitle>
        <DialogDescription>
          {reset
            ? "Running sessions are stopped. Project files and logs are kept."
            : "Project and profile records are merged. Included settings, default shell and shortcut overrides replace their current configuration."}
        </DialogDescription>
        <div
          ref={summary}
          tabIndex={-1}
          className="min-w-0 space-y-2 break-words text-sm outline-none"
        >
          {data.preview && "createdAtMs" in data.preview ? (
            <>
              <p>
                Backup schema {data.preview.schemaVersion} · XWork {data.preview.sourceAppVersion}
              </p>
              <p>{backupDate(data.preview.createdAtMs)}</p>
              <p>
                Projects: {data.preview.counts.projects} · Custom CLI profiles:{" "}
                {data.preview.counts.customCliProfiles}
              </p>
              <p>
                Secret references: {data.preview.counts.secretReferences} · Shortcut overrides:{" "}
                {data.preview.counts.keyboardShortcutOverrides}
              </p>
              <p>
                Inserts: {data.preview.merge.inserts} · Updates: {data.preview.merge.updates} ·
                Unchanged: {data.preview.merge.unchanged}
              </p>
              <p>
                Removals: {data.preview.merge.removals} · Project path matches:{" "}
                {data.preview.merge.projectPathMatches}
              </p>
              <p>Projects matching a local path may keep their local identity.</p>
              <p>Secret values are not included. You may need to re-enter them on this machine.</p>
            </>
          ) : data.preview && "sessions" in data.preview ? (
            <>
              <p>
                Projects: {data.preview.projects} · Custom CLI profiles:{" "}
                {data.preview.customCliProfiles}
              </p>
              <p>Shortcut overrides: {data.preview.keyboardShortcutOverrides}</p>
              <p>
                Settings differ from defaults:{" "}
                {data.preview.settingsDifferFromDefault ? "Yes" : "No"}
              </p>
              <p>
                Sessions: {data.preview.sessions} · Running processes:{" "}
                {data.preview.runningProcesses}
              </p>
              {data.preview.unsavedDocuments > 0 && (
                <p role="alert">
                  Unsaved documents: {data.preview.unsavedDocuments}. Unsaved changes will be lost.
                </p>
              )}
              <p>
                Counts may change. Reset stops all sessions and removes all current XWork data in
                the categories above.
              </p>
              <label className="block" htmlFor="data-reset-confirmation">
                Type RESET to confirm
              </label>
              <Input
                id="data-reset-confirmation"
                autoComplete="off"
                value={data.confirmation}
                disabled={applying}
                onChange={
                  /** Preserve the user's case and spacing. */ (event) =>
                    data.setConfirmation(event.target.value)
                }
                onKeyDown={
                  /** Enter and IME never submit the destructive action from this input. */ (
                    event,
                  ) => {
                    if (event.key === "Enter") event.preventDefault();
                  }
                }
              />
            </>
          ) : null}
        </div>
        {data.failure && <p role="alert">{dataErrorCopy(data.failure)}</p>}
        {applying && (
          <p role="status" className="flex items-center gap-2">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {reset ? "Resetting XWork…" : "Importing backup…"}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={cancel}
            variant="outline"
            disabled={applying}
            onClick={/** Retire the reviewed request. */ () => void data.cancel()}
          >
            Cancel
          </Button>
          <Button
            variant={reset ? "destructive" : "default"}
            disabled={data.busy || (reset && data.confirmation.trim() !== "RESET")}
            onKeyDown={
              /** Ignore IME activation on the confirm control. */ (event) => {
                if (event.nativeEvent.isComposing) event.preventDefault();
              }
            }
            onClick={/** Confirm only this explicit user activation. */ () => void data.confirm()}
          >
            {reset ? "Reset XWork" : "Import backup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
