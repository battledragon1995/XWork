import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

// Render the repository-owned shadcn-style range slider over the pinned `radix-ui` package.
// The upstream snapshot is localized the same way as the other copied primitives: the dark
// utility classes are dropped because FE-012 owns that palette through CSS variables, and
// the focus ring matches every other focusable control in the shell.
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  // Radix renders one thumb per value, so the thumb count follows whichever value is set.
  const values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-cream-strong"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-brand" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          // Radix names the thumb, not the root, so the caller's label is forwarded here.
          aria-label={ariaLabel}
          data-slot="slider-thumb"
          // Thumbs are positional and interchangeable, so the index is their only identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: a thumb has no other stable identity
          key={index}
          className="block size-4 shrink-0 rounded-full border border-brand bg-canvas shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
