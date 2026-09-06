import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Owns the controlled state of a nonmodal anchored surface. */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}
/** Anchors the surface to an existing accessible button. */
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}
/** Ports content outside titlebar clipping while preserving Radix dismissal semantics. */
function PopoverContent({
  className,
  align = "right",
  sideOffset = 4,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "align"> & {
  align?: "start" | "center" | "end" | "right";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align === "right" ? "end" : align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 rounded-lg border border-hairline bg-canvas text-body shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
