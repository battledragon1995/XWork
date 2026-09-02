import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils/cn";

// Describe the shared button shape plus every visual variant and size the shell needs.
// Animation utilities from the upstream snapshot are removed so reduced-motion users see
// the exact same behavior as everyone else.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground active:bg-primary-active",
        destructive: "bg-destructive text-destructive-foreground focus-visible:ring-destructive",
        outline: "border border-border bg-background text-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        ghost: "bg-transparent text-foreground",
        link: "text-primary underline-offset-4",
      },
      size: {
        default: "h-8 px-3.5 has-[>svg]:px-3",
        sm: "h-6.5 gap-1.5 rounded-sm px-2.5 text-xs",
        lg: "h-9 rounded-md px-4",
        icon: "size-7 rounded-sm",
        "icon-sm": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// Render a button, or delegate every button prop to a single child when `asChild` is set.
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
