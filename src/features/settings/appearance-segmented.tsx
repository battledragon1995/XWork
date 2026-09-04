import { type KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils/cn";

/** One choice inside a segmented control. */
export interface AppearanceSegmentedOption<TValue extends string> {
  value: TValue;
  label: string;
}

/**
 * Render a joined group of mutually exclusive choices with radio semantics and the roving
 * focus WAI-ARIA expects: one stop in the tab order, arrows to move, `Home`/`End` to jump.
 */
export function AppearanceSegmented<TValue extends string>(props: {
  label: string;
  value: TValue;
  options: readonly AppearanceSegmentedOption<TValue>[];
  onChange(next: TValue): void;
}) {
  const { label, value, options, onChange } = props;
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  /** Move focus to one option and select it, which is how a radio group behaves. */
  const focusOption = (index: number) => {
    const target = options[index];
    if (target === undefined) {
      return;
    }
    buttonsRef.current[index]?.focus();
    onChange(target.value);
  };

  /** Translate the arrow, Home and End keys into a wrapping move inside the group. */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((index + 1) % options.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  };

  return (
    <div
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-hairline bg-surface-soft p-0.5"
      role="radiogroup"
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        // A native radio cannot carry the joined-segment visual this control needs, so the
        // group implements the roving focus and selection semantics itself.
        return (
          // biome-ignore lint/a11y/useSemanticElements: a joined segment needs a button
          <button
            aria-checked={checked}
            className={cn(
              "h-6.5 rounded-sm px-3 text-[12px] font-medium whitespace-nowrap text-body outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked && "bg-canvas text-ink shadow-sm",
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            role="radio"
            tabIndex={index === selectedIndex ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
