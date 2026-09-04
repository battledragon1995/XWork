import { Check } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import type { ThemePresetDto } from "@/bindings/settings";
import { cn } from "@/lib/utils/cn";

/** A preset the user can pick; `custom` is a backend state, never an offered choice. */
export type BuiltInThemePreset = Exclude<ThemePresetDto, "custom">;

/**
 * Fixed two-swatch illustrations taken from the wireframe. These are presentation only:
 * the real preset palettes are owned by the backend and arrive with the snapshot, so a
 * drift here can never change the colours the window actually paints.
 */
export const PRESET_CARDS: ReadonlyArray<{
  value: BuiltInThemePreset;
  label: string;
  swatches: readonly [string, string];
}> = [
  { value: "cream", label: "Cream", swatches: ["#f5f0e8", "#faf9f5"] },
  { value: "ink", label: "Ink", swatches: ["#1f1e1b", "#181715"] },
  { value: "paper", label: "Paper", swatches: ["#f1efe9", "#ffffff"] },
];

/** Render the three built-in presets as a radio group, plus the customized-palette state. */
export function AppearancePresetCards(props: {
  value: ThemePresetDto;
  onChange(next: BuiltInThemePreset): void;
}) {
  const { value, onChange } = props;
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = PRESET_CARDS.findIndex((card) => card.value === value);
  // A customized palette selects no card, so the first one still owns the single tab stop.
  const focusIndex = selectedIndex === -1 ? 0 : selectedIndex;

  /** Move focus to one card and select it, which is how a radio group behaves. */
  const focusCard = (index: number) => {
    const target = PRESET_CARDS[index];
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
      focusCard((index - 1 + PRESET_CARDS.length) % PRESET_CARDS.length);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusCard((index + 1) % PRESET_CARDS.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusCard(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusCard(PRESET_CARDS.length - 1);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div
        aria-label="Preset"
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2"
        role="radiogroup"
      >
        {PRESET_CARDS.map((card, index) => {
          const checked = card.value === value;
          // A native radio cannot carry the card visual this control needs, so the group
          // implements the roving focus and selection semantics itself.
          return (
            // biome-ignore lint/a11y/useSemanticElements: a preset card needs a button
            <button
              aria-checked={checked}
              className={cn(
                "min-w-0 rounded-md border border-hairline bg-canvas p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                checked && "border-brand",
              )}
              key={card.value}
              onClick={() => onChange(card.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(element) => {
                buttonsRef.current[index] = element;
              }}
              role="radio"
              tabIndex={index === focusIndex ? 0 : -1}
              type="button"
            >
              <span aria-hidden="true" className="flex h-8 overflow-hidden rounded-sm">
                {card.swatches.map((swatch) => (
                  <span
                    className="h-full flex-1"
                    key={swatch}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </span>
              <span className="mt-1.5 flex items-center justify-between gap-1 text-[12px] font-medium text-body-strong">
                <span className="truncate">{card.label}</span>
                {checked && <Check aria-hidden="true" className="size-3.5 shrink-0 text-brand" />}
              </span>
            </button>
          );
        })}
      </div>
      {value === "custom" && <p className="text-[12px] text-muted">Custom colours</p>}
    </div>
  );
}
