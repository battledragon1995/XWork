import { useRef, useState } from "react";
import type { TabDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SESSION_NAME_REQUIREMENT,
  type SessionsFailure,
  validateSessionName,
} from "@/lib/utils/session-copy";

/** Ask for a valid replacement name for one tab. */
export function RenameTabDialog(props: {
  tab: TabDto | null;
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onSubmit(name: string): void;
  onClosed(): void;
}) {
  return (
    <Dialog
      open={props.tab !== null}
      onOpenChange={(open) => {
        if (!open && !props.isPending) props.onCancel();
      }}
    >
      {props.tab !== null && (
        <DialogContent
          key={props.tab.id}
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            props.onClosed();
          }}
        >
          <RenameTabForm {...props} tab={props.tab} />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Own the input value for one fresh dialog opening. */
function RenameTabForm(props: {
  tab: TabDto;
  isPending: boolean;
  failure: SessionsFailure | null;
  onCancel(): void;
  onSubmit(name: string): void;
}) {
  const [value, setValue] = useState(props.tab.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const validated = validateSessionName(value);
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (validated.isValid && !props.isPending) props.onSubmit(validated.value);
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename tab</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="rename-tab-name" className="text-[13px] font-medium text-body-strong">
          Tab name
        </label>
        <Input
          id="rename-tab-name"
          ref={inputRef}
          value={value}
          disabled={props.isPending}
          aria-invalid={!validated.isValid}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          onFocus={() => inputRef.current?.select()}
        />
        {!validated.isValid && <p className="text-xs text-muted">{SESSION_NAME_REQUIREMENT}</p>}
      </div>
      {props.failure !== null && (
        <p role="alert" className="text-[13px] text-error">
          {props.failure.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={props.isPending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!validated.isValid || props.isPending}>
          {props.isPending ? "Renaming…" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}
