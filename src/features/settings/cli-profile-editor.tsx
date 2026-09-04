import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  CliProfileDto,
  CliProfileInputDto,
  CliShellDto,
} from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { type CliProfilesFailure, readCliProfileErrorTarget } from "./cli-profile-error-copy";
import {
  addArgumentRow,
  addEnvironmentRow,
  beginReplaceStoredValue,
  buildCliProfileInput,
  canKeepStoredValue,
  type CliEnvironmentDraft,
  type CliProfileDraft,
  type CliProfileFormField,
  type CliProfileValidation,
  createEditProfileDraft,
  createEmptyProfileDraft,
  isCliProfileDraftDirty,
  keepStoredValue,
  MAX_ARGUMENT_ROWS,
  MAX_ENVIRONMENT_ROWS,
  moveDraftRow,
  removeDraftRow,
  setEnvironmentName,
  setEnvironmentSecret,
  SYSTEM_SHELL_ID,
  validateCliProfileDraft,
} from "./cli-profile-form";

/** Position and size the FE-013 sheet, which the shared centred dialog does not provide. */
const SHEET_CLASS =
  "top-0 right-0 bottom-0 left-auto h-full w-[min(520px,100vw)] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 rounded-none p-0 shadow-pop sm:max-w-none";

/** Identify one repeated row's own input, so validation can focus the exact offending row. */
function rowInputId(rowKey: string): string {
  return `cli-profile-row-${rowKey}`;
}

/** Shared select styling, kept local because FE-013 adds no shared form primitive. */
const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

/** What the page hands the editor. `source` is the live snapshot entry of the edited profile. */
export interface CliProfileEditorProps {
  open: boolean;
  mode: "create" | "edit";
  source: CliProfileDto | null;
  shells: readonly CliShellDto[];
  failure: CliProfilesFailure | null;
  isChecking: boolean;
  onClose(): void;
  onSave(profileId: string | null, input: CliProfileInputDto): Promise<boolean>;
  onCheck(profileId: string): void;
  onMissing(): void;
}

/** Render one labelled field with its own error message and description wiring. */
function Field(props: {
  label: string;
  htmlFor: string;
  errorId: string;
  errorMessage: string | undefined;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-[12px] font-medium text-body-strong" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint !== undefined && <p className="text-[11px] text-muted">{props.hint}</p>}
      {props.errorMessage !== undefined && (
        <p className="text-[11px] text-error" id={props.errorId}>
          {props.errorMessage}
        </p>
      )}
    </div>
  );
}

/** Render the two reorder controls and the remove control one repeated row needs. */
function RowControls(props: {
  index: number;
  count: number;
  noun: string;
  disabled: boolean;
  onMove(offset: number): void;
  onRemove(): void;
}) {
  const position = props.index + 1;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        aria-label={`Move ${props.noun} ${position} up`}
        disabled={props.disabled || props.index === 0}
        onClick={() => props.onMove(-1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={`Move ${props.noun} ${position} down`}
        disabled={props.disabled || props.index === props.count - 1}
        onClick={() => props.onMove(1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={`Remove ${props.noun} ${position}`}
        disabled={props.disabled}
        onClick={props.onRemove}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </span>
  );
}

/**
 * Render one environment row. A stored secret is described rather than shown: the plaintext is
 * unreadable to this layer, so the row offers a replacement instead of a value it cannot have.
 */
function EnvironmentRow(props: {
  row: CliEnvironmentDraft;
  index: number;
  count: number;
  disabled: boolean;
  errorMessage: string | undefined;
  onChange(next: CliEnvironmentDraft): void;
  onMove(offset: number): void;
  onRemove(): void;
}) {
  const { row, index, count, disabled, errorMessage } = props;
  const position = index + 1;
  const errorId = useId();
  const showsStoredValue = canKeepStoredValue(row);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          aria-describedby={errorMessage === undefined ? undefined : errorId}
          aria-invalid={errorMessage === undefined ? undefined : true}
          aria-label={`Variable ${position} name`}
          autoComplete="off"
          id={rowInputId(row.key)}
          className="h-7 flex-1 font-mono text-[12px]"
          disabled={disabled}
          onChange={(event) => props.onChange(setEnvironmentName(row, event.currentTarget.value))}
          spellCheck={false}
          value={row.name}
        />
        {showsStoredValue ? (
          <span className="flex flex-1 items-center gap-2">
            <span className="text-[12px] text-muted">Stored securely</span>
            <Button
              aria-label={`Replace value for variable ${position}`}
              disabled={disabled}
              onClick={() => props.onChange(beginReplaceStoredValue(row))}
              size="sm"
              type="button"
              variant="outline"
            >
              Replace value
            </Button>
          </span>
        ) : (
          <span className="flex flex-1 items-center gap-2">
            <Input
              aria-label={`Variable ${position} value`}
              autoComplete="off"
              className="h-7 flex-1 font-mono text-[12px]"
              disabled={disabled}
              onChange={(event) => props.onChange({ ...row, value: event.currentTarget.value })}
              spellCheck={false}
              type={row.isSecret ? "password" : "text"}
              value={row.value}
            />
            {row.replaceStoredValue && (
              <Button
                aria-label={`Keep stored value for variable ${position}`}
                disabled={disabled}
                onClick={() => props.onChange(keepStoredValue(row))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            )}
          </span>
        )}
        <Switch
          aria-label={`Variable ${position} secret`}
          checked={row.isSecret}
          disabled={disabled}
          onCheckedChange={(checked) => props.onChange(setEnvironmentSecret(row, checked))}
        />
        <RowControls
          count={count}
          disabled={disabled}
          index={index}
          noun="variable"
          onMove={props.onMove}
          onRemove={props.onRemove}
        />
      </div>
      {errorMessage !== undefined && (
        <p className="text-[11px] text-error" id={errorId}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}

/** Confirm leaving one sheet whose draft differs from the profile it was opened on. */
function DiscardChangesDialog(props: { open: boolean; onKeepEditing(): void; onDiscard(): void }) {
  return (
    <Dialog onOpenChange={(next) => !next && props.onKeepEditing()} open={props.open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Discard profile changes?</DialogTitle>
          <DialogDescription>
            The edits in this sheet have not been saved. Discarding them cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={props.onKeepEditing} type="button" variant="outline">
            Keep Editing
          </Button>
          <Button onClick={props.onDiscard} type="button" variant="destructive">
            Discard Profile Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Render the create/edit sheet. The draft — including any plaintext a secret row holds — lives
 * only in this component's state: it never reaches the store, the URL, webview storage, a log
 * or an error message, and it is dropped as soon as the sheet unmounts.
 */
export function CliProfileEditor(props: CliProfileEditorProps) {
  const { open, mode, source, shells, failure, isChecking } = props;
  const nameId = useId();
  const iconId = useId();
  const colorId = useId();
  const commandId = useId();
  const shellId = useId();
  const errorIds = {
    name: `${nameId}-error`,
    icon: `${iconId}-error`,
    color: `${colorId}-error`,
    command: `${commandId}-error`,
    shell: `${shellId}-error`,
  };

  const [draft, setDraft] = useState<CliProfileDraft>(createEmptyProfileDraft);
  /** The profile revision the draft was last built from, used to detect an external edit. */
  const [baseline, setBaseline] = useState<CliProfileDto | null>(null);
  const [conflict, setConflict] = useState(false);
  const [validation, setValidation] = useState<CliProfileValidation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /** Control that opened the sheet, so closing it can hand focus straight back. */
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLSelectElement>(null);

  const isBuiltIn = source?.kind === "builtIn";
  const isDirty = isCliProfileDraftDirty(draft, baseline);

  // The three refs below let the two effects depend on data alone. Reading the live source,
  // the dirty flag and the callback through a ref is what keeps a snapshot refresh — or a
  // single keystroke — from re-running work that belongs to one opening of the sheet.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onMissingRef = useRef(props.onMissing);
  onMissingRef.current = props.onMissing;

  /** Identity of one opening of the sheet; an empty string means it is closed. */
  const sessionKey = open ? `${mode}:${source?.id ?? ""}` : "";

  // Build the draft once per opening. Reopening the sheet always starts from committed data.
  useEffect(() => {
    if (sessionKey === "") {
      return;
    }

    setValidation(null);
    setConflict(false);
    setDiscarding(false);
    if (mode === "create") {
      setDraft(createEmptyProfileDraft());
      setBaseline(null);
      return;
    }

    const opened = sourceRef.current;
    if (opened !== null && opened.kind === "custom") {
      setDraft(createEditProfileDraft(opened));
      setBaseline(opened);
    }
  }, [sessionKey, mode]);

  // Hand focus back to the control that opened the sheet once it is gone.
  useEffect(() => {
    if (open) {
      return;
    }

    const opener = openerRef.current;
    wasOpenRef.current = false;
    openerRef.current = null;
    if (opener !== null && document.contains(opener)) {
      opener.focus();
    }
  }, [open]);

  // Reconcile the open sheet with every later snapshot of the same profile.
  useEffect(() => {
    if (!open || mode !== "edit" || baseline === null) {
      return;
    }

    if (source === null) {
      onMissingRef.current();
      return;
    }

    // Availability and effective shell are not editable, so a refresh that changed only those
    // must never resynchronize a draft or raise a conflict.
    const editableChanged = isCliProfileDraftDirty(createEditProfileDraft(source), baseline);
    if (!editableChanged) {
      return;
    }

    if (isDirtyRef.current) {
      setConflict(true);
      return;
    }

    setDraft(createEditProfileDraft(source));
    setBaseline(source);
  }, [open, mode, source, baseline]);

  // A built-in has no editor entry point, and a vanished profile has nothing left to edit.
  // Closing through the `open` prop rather than an early return is what lets Radix run its
  // own teardown and hand focus back to the row button that opened the sheet.
  const isOpen = open && (mode === "create" || (source !== null && !isBuiltIn));

  // The opener has to be read on the opening render itself: a child effect inside the modal
  // has already moved focus into the sheet by the time this component's own effects run.
  if (isOpen && !wasOpenRef.current) {
    wasOpenRef.current = true;
    openerRef.current = document.activeElement as HTMLElement | null;
  }

  const backendTarget = failure === null ? null : readCliProfileErrorTarget(failure.code);
  const fieldError = (field: CliProfileFormField): string | undefined =>
    validation?.fields[field] ??
    (backendTarget === field && failure !== null ? failure.message : undefined);
  const bannerMessage =
    failure !== null && backendTarget === null && failure.operation !== "check"
      ? failure.message
      : null;
  const canCheck = mode === "edit" && !isDirty && !isSubmitting && !isChecking;
  const concreteShells = shells.filter(
    (shell) => shell.id !== SYSTEM_SHELL_ID && shell.isAvailable,
  );
  const isLocked = isSubmitting;

  /** Move focus to the control the first validation message belongs to. */
  const focusFirstError = (result: CliProfileValidation): void => {
    const first = result.firstError;
    if (first === null) {
      return;
    }

    // A group error belongs to one repeated row, which owns its own input rather than a
    // single named control, so it is reached by the row key instead of a ref.
    if (first.rowKey !== null) {
      document.getElementById(rowInputId(first.rowKey))?.focus();
      return;
    }

    const targets: Partial<Record<CliProfileFormField, HTMLElement | null>> = {
      name: nameRef.current,
      icon: iconRef.current,
      color: colorRef.current,
      command: commandRef.current,
      shell: shellRef.current,
    };
    targets[first.field]?.focus();
  };

  /** Validate locally, then hand one full replacement payload to the page. */
  const handleSave = async (): Promise<void> => {
    if (isSubmitting || conflict) {
      return;
    }

    const result = validateCliProfileDraft(draft, shells);
    setValidation(result);
    if (!result.isValid) {
      focusFirstError(result);
      return;
    }

    setIsSubmitting(true);
    try {
      const accepted = await props.onSave(draft.profileId, buildCliProfileInput(draft));
      if (accepted) {
        props.onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Ask to close, confirming first whenever the sheet still holds unsaved work. */
  const requestClose = (): void => {
    if (isSubmitting) {
      return;
    }
    if (isDirty) {
      setDiscarding(true);
      return;
    }
    props.onClose();
  };

  /** Replace the draft with the committed profile after an external change. */
  const handleReload = (): void => {
    if (source === null) {
      return;
    }
    setDraft(createEditProfileDraft(source));
    setBaseline(source);
    setConflict(false);
    setValidation(null);
  };

  return (
    <>
      <Dialog onOpenChange={(next) => !next && requestClose()} open={isOpen}>
        <DialogContent
          className={SHEET_CLASS}
          onOpenAutoFocus={(event) => {
            // Radix would focus the header Close button first; FE-013 asks for the Name field.
            event.preventDefault();
            nameRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // The sheet owns its own dismissal, so Radix must not close it behind the guard.
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            requestClose();
          }}
          showCloseButton={false}
        >
          <DialogHeader className="flex-row items-center justify-between border-b border-hairline px-5 py-3.5">
            <DialogTitle className="text-[18px]">
              {mode === "create" ? "New profile" : "Edit profile"}
            </DialogTitle>
            <Button
              aria-label="Close"
              disabled={isLocked}
              onClick={requestClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Configure one custom CLI profile. Arguments and environment values stay separate fields.
          </DialogDescription>

          <div
            className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4"
            data-testid="cli-profile-editor-body"
          >
            {bannerMessage !== null && (
              <p
                className="rounded-md bg-surface-card px-3 py-2 text-[12px] text-error"
                role="alert"
              >
                {bannerMessage}
              </p>
            )}

            {conflict && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-warn-ink/40 px-3 py-2">
                <p className="text-[12px] text-warn-ink">
                  This profile changed in XWork. Reload it before saving.
                </p>
                <Button onClick={handleReload} size="sm" type="button" variant="outline">
                  Reload Profile
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field
                errorId={errorIds.name}
                errorMessage={fieldError("name")}
                htmlFor={nameId}
                label="Name"
              >
                <Input
                  aria-describedby={fieldError("name") === undefined ? undefined : errorIds.name}
                  aria-invalid={fieldError("name") === undefined ? undefined : true}
                  autoComplete="off"
                  disabled={isLocked}
                  id={nameId}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  ref={nameRef}
                  value={draft.name}
                />
              </Field>
              <div className="flex min-w-0 items-end gap-2">
                <Field
                  errorId={errorIds.icon}
                  errorMessage={fieldError("icon")}
                  htmlFor={iconId}
                  label="Icon"
                >
                  <Input
                    aria-describedby={fieldError("icon") === undefined ? undefined : errorIds.icon}
                    aria-invalid={fieldError("icon") === undefined ? undefined : true}
                    autoComplete="off"
                    className="w-[72px]"
                    disabled={isLocked}
                    id={iconId}
                    onChange={(event) => setDraft({ ...draft, icon: event.currentTarget.value })}
                    ref={iconRef}
                    value={draft.icon}
                  />
                </Field>
                <Field
                  errorId={errorIds.color}
                  errorMessage={fieldError("color")}
                  htmlFor={colorId}
                  label="Colour"
                >
                  <span className="flex items-center gap-2">
                    <input
                      aria-label="Colour picker"
                      className="size-7 shrink-0 cursor-pointer rounded-sm border border-hairline bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={isLocked}
                      onChange={(event) =>
                        setDraft({ ...draft, color: event.currentTarget.value.toLowerCase() })
                      }
                      type="color"
                      value={
                        /^#[0-9a-f]{6}$/.test(draft.color.toLowerCase())
                          ? draft.color.toLowerCase()
                          : "#000000"
                      }
                    />
                    <Input
                      aria-describedby={
                        fieldError("color") === undefined ? undefined : errorIds.color
                      }
                      aria-invalid={fieldError("color") === undefined ? undefined : true}
                      autoComplete="off"
                      className="w-[104px] font-mono text-[12px]"
                      disabled={isLocked}
                      id={colorId}
                      onChange={(event) => setDraft({ ...draft, color: event.currentTarget.value })}
                      ref={colorRef}
                      spellCheck={false}
                      value={draft.color}
                    />
                  </span>
                </Field>
              </div>
            </div>

            <Field
              errorId={errorIds.command}
              errorMessage={fieldError("command")}
              htmlFor={commandId}
              label="Command"
            >
              <Input
                aria-describedby={
                  fieldError("command") === undefined ? undefined : errorIds.command
                }
                aria-invalid={fieldError("command") === undefined ? undefined : true}
                autoComplete="off"
                className="font-mono text-[12px]"
                disabled={isLocked}
                id={commandId}
                onChange={(event) => setDraft({ ...draft, command: event.currentTarget.value })}
                ref={commandRef}
                spellCheck={false}
                value={draft.command}
              />
            </Field>

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="text-[12px] font-medium text-body-strong">Arguments</legend>
              {draft.arguments.length === 0 ? (
                <p className="text-[12px] text-muted">No arguments yet.</p>
              ) : (
                draft.arguments.map((row, index) => (
                  <div className="flex min-w-0 flex-col gap-1" key={row.key}>
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        aria-invalid={
                          validation?.argumentRows[row.key] === undefined ? undefined : true
                        }
                        aria-label={`Argument ${index + 1}`}
                        autoComplete="off"
                        id={rowInputId(row.key)}
                        className="h-7 flex-1 font-mono text-[12px]"
                        disabled={isLocked}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            arguments: draft.arguments.map((entry, position) =>
                              position === index
                                ? { ...entry, value: event.currentTarget.value }
                                : entry,
                            ),
                          })
                        }
                        spellCheck={false}
                        value={row.value}
                      />
                      <RowControls
                        count={draft.arguments.length}
                        disabled={isLocked}
                        index={index}
                        noun="argument"
                        onMove={(offset) =>
                          setDraft({
                            ...draft,
                            arguments: moveDraftRow(draft.arguments, index, offset),
                          })
                        }
                        onRemove={() =>
                          setDraft({ ...draft, arguments: removeDraftRow(draft.arguments, index) })
                        }
                      />
                    </div>
                    {validation?.argumentRows[row.key] !== undefined && (
                      <p className="text-[11px] text-error">{validation.argumentRows[row.key]}</p>
                    )}
                  </div>
                ))
              )}
              {fieldError("arguments") !== undefined && (
                <p className="text-[11px] text-error">{fieldError("arguments")}</p>
              )}
              <p className="text-[11px] text-muted">
                Each row is passed as one argument. Values are never joined into a shell string.
              </p>
              <div>
                <Button
                  disabled={isLocked || draft.arguments.length >= MAX_ARGUMENT_ROWS}
                  onClick={() => setDraft(addArgumentRow(draft))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Add argument
                </Button>
              </div>
            </fieldset>

            <Field
              errorId={errorIds.shell}
              errorMessage={fieldError("shell")}
              htmlFor={shellId}
              label="Shell (optional)"
            >
              <select
                aria-describedby={fieldError("shell") === undefined ? undefined : errorIds.shell}
                aria-invalid={fieldError("shell") === undefined ? undefined : true}
                className={SELECT_CLASS}
                disabled={isLocked}
                id={shellId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    shellId: event.currentTarget.value === "" ? null : event.currentTarget.value,
                  })
                }
                ref={shellRef}
                value={draft.shellId ?? ""}
              >
                <option value="">Use default shell</option>
                {concreteShells.map((shell) => (
                  <option key={shell.id} value={shell.id}>
                    {shell.displayName}
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="text-[12px] font-medium text-body-strong">
                Environment variables
              </legend>
              {draft.environment.length === 0 ? (
                <p className="text-[12px] text-muted">No environment variables yet.</p>
              ) : (
                draft.environment.map((row, index) => (
                  <EnvironmentRow
                    count={draft.environment.length}
                    disabled={isLocked}
                    errorMessage={validation?.environmentRows[row.key]}
                    index={index}
                    key={row.key}
                    onChange={(next) =>
                      setDraft({
                        ...draft,
                        environment: draft.environment.map((entry, position) =>
                          position === index ? next : entry,
                        ),
                      })
                    }
                    onMove={(offset) =>
                      setDraft({
                        ...draft,
                        environment: moveDraftRow(draft.environment, index, offset),
                      })
                    }
                    onRemove={() =>
                      setDraft({
                        ...draft,
                        environment: removeDraftRow(draft.environment, index),
                      })
                    }
                    row={row}
                  />
                ))
              )}
              {fieldError("environment") !== undefined && (
                <p className="text-[11px] text-error">{fieldError("environment")}</p>
              )}
              <p className="text-[11px] text-muted">
                Secret values are stored in the operating system credential store and are never
                shown or exported in backups.
              </p>
              <div>
                <Button
                  disabled={isLocked || draft.environment.length >= MAX_ENVIRONMENT_ROWS}
                  onClick={() => setDraft(addEnvironmentRow(draft))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Add variable
                </Button>
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <Button
                disabled={!canCheck}
                onClick={() => draft.profileId !== null && props.onCheck(draft.profileId)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Check command
              </Button>
              {(mode === "create" || isDirty) && (
                <span className="text-[11px] text-muted">Save changes before checking.</span>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-hairline px-5 py-3.5">
            <Button disabled={isLocked} onClick={requestClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isLocked || conflict} onClick={() => void handleSave()} type="button">
              {isSubmitting ? "Saving…" : "Save profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiscardChangesDialog
        onDiscard={() => {
          setDiscarding(false);
          props.onClose();
        }}
        onKeepEditing={() => setDiscarding(false)}
        open={discarding}
      />
    </>
  );
}
