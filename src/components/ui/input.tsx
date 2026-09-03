import type * as React from "react";
import { cn } from "@/lib/utils/cn";

// Render one single-line text field. The upstream snapshot is localized to this repository:
// the dark-theme utilities are dropped because FE-012 owns that palette, the colour transition
// is dropped so reduced-motion users see identical behavior, and the focus ring matches the
// copied button so every focused control in the shell looks the same. Callers own their own
// height, width and type scale.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
