import { type KeyboardEvent, useCallback, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isFullHex, normalizeHex } from "./appearance-contrast";

/** Message shown once the user leaves a field whose text is not a full hex colour. */
const FORMAT_ERROR = "Use a #rrggbb colour.";

/** Render one labelled colour row: a native picker, a hex field, and this row's own error. */
export function AppearanceColorField(props: {
  label: string;
  value: string;
  errorMessage?: string;
  variant?: "row" | "swatch" | "chip";
  onChange(next: string): void;
  onCommitNow(): void;
}) {
  const { label, value, errorMessage, variant = "row", onChange, onCommitNow } = props;
  const [open, setOpen] = useState(false);
  const textId = useId();
  const errorId = useId();
  const [rawText, setRawText] = useState(value);
  const [blurred, setBlurred] = useState(false);
  const lastValueRef = useRef(value);
  const commitNowRef = useRef(onCommitNow);
  commitNowRef.current = onCommitNow;

  // A backend response can normalize or replace the colour, which must win over stale text.
  if (lastValueRef.current !== value) {
    lastValueRef.current = value;
    setRawText(value);
    setBlurred(false);
  }

  /** Connect native commit events whenever the inline or popover picker mounts. */
  const pickerRef = useCallback((picker: HTMLInputElement | null) => {
    if (picker === null) {
      return;
    }

    /** Persist immediately once the operating-system colour dialog closes. */
    const handlePickerChange = () => {
      commitNowRef.current();
    };

    picker.addEventListener("change", handlePickerChange);
    return () => picker.removeEventListener("change", handlePickerChange);
  }, []);

  const formatError = blurred && !isFullHex(rawText) ? FORMAT_ERROR : null;
  const message = formatError ?? errorMessage ?? null;
  const pickerValue = normalizeHex(rawText) ?? normalizeHex(value) ?? "#000000";

  /** Report a raw hex edit; the editor decides whether it can preview or persist it. */
  const handleTextChange = (next: string) => {
    setRawText(next);
    setBlurred(false);
    onChange(next);
  };

  /** Keep the native picker and the hex field showing the same colour while dragging. */
  const handlePickerInput = (next: string) => {
    const normalized = next.toLowerCase();
    setRawText(normalized);
    setBlurred(false);
    onChange(normalized);
  };

  /** Confirm with Enter, and revert the row to its current colour with Escape. */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const normalized = normalizeHex(rawText);
      if (normalized === null) {
        setBlurred(true);
        return;
      }
      setRawText(normalized);
      onChange(normalized);
      onCommitNow();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setRawText(value);
      setBlurred(false);
      onChange(value);
    }
  };

  const controls = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <label className="text-[13px] text-body" htmlFor={textId}>
          {label}
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <input
            aria-label={`${label} colour picker`}
            className="size-7 cursor-pointer rounded-sm border border-hairline bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onInput={(event) => handlePickerInput(event.currentTarget.value)}
            ref={pickerRef}
            type="color"
            value={pickerValue}
          />
          <Input
            aria-describedby={message === null ? undefined : errorId}
            aria-invalid={message === null ? undefined : true}
            autoComplete="off"
            className="h-7 w-[104px] font-mono text-[12px]"
            id={textId}
            onBlur={() => setBlurred(true)}
            onChange={(event) => handleTextChange(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            value={rawText}
          />
        </div>
      </div>
      {message !== null && (
        <p className="text-right text-[12px] text-error" id={errorId}>
          {message}
        </p>
      )}
    </div>
  );

  if (variant === "row") {
    return controls;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-invalid={message === null ? undefined : true}
          aria-label={`Edit ${label}`}
          className="flex min-w-0 items-center gap-2 rounded-sm text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`${label}: ${message ?? value}`}
          type="button"
        >
          <span
            className="h-6 min-w-6 flex-1 rounded-sm border border-hairline"
            style={{ backgroundColor: pickerValue }}
          />
          {variant === "chip" && <span>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">{controls}</PopoverContent>
    </Popover>
  );
}
