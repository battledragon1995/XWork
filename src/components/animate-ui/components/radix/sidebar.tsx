import { cva, type VariantProps } from "class-variance-authority";
import type { Transition } from "motion/react";
import { Slot } from "radix-ui";
import * as React from "react";
import { getStrictContext } from "@/components/animate-ui/lib/get-strict-context";
import { Highlight, HighlightItem } from "@/components/animate-ui/primitives/effects/highlight";
import { cn } from "@/lib/utils/cn";

/*
 * Animate UI sidebar (https://animate-ui.com/r/components-radix-sidebar.json), trimmed for a
 * desktop-only application. Local changes kept on purpose, all fixed by FE-001:
 *
 * - No mobile presentation: the `Sheet` branch, the `useIsMobile` hook and the `md:` visibility
 *   classes are gone, so no viewport width can hide the sidebar of a desktop window.
 * - No `sidebar_state` cookie: persistence belongs to the backend, not to the webview.
 * - No `Ctrl+B` listener: shortcuts are owned by the shortcut catalogue, not by a primitive.
 * - No `SidebarInput`, `SidebarMenuSkeleton`, `SidebarSeparator`, `SidebarRail` or
 *   `SidebarTrigger`: the first three only existed to pull in components this repository does
 *   not vendor, and the last two duplicate controls the shell already owns.
 * - No `tooltip` prop on `SidebarMenuButton`: the call site owns the tooltip so its trigger
 *   sits on the link itself and the tooltip also opens on keyboard focus.
 * - Added `isResizing`, plus `motion-reduce:transition-none`, so the width transition can be
 *   suppressed while the seam is dragged and for reduced-motion users.
 * - `SidebarContent` scrolls on the vertical axis only. Upstream uses `overflow-auto` and
 *   relies on `data-collapsible` to clip the horizontal axis, but that attribute clears on
 *   the first frame of the expand animation, while the column is still icon-narrow and the
 *   Projects block is already mounted at full width. Every entry here truncates by design,
 *   so the horizontal axis is never meant to scroll.
 */

/** Width the sidebar opens at when a caller does not override the custom property. */
const SIDEBAR_WIDTH = "16rem";
/** Width of the icon-only sidebar, `56px` at the default root font size. */
const SIDEBAR_WIDTH_ICON = "3.5rem";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const [LocalSidebarProvider, useSidebar] = getStrictContext<SidebarContextProps>("SidebarContext");

type SidebarProviderProps = React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Publish the expanded/collapsed state to every sidebar part and reserve the width custom
// properties. A controlled `open` lets the application store stay the single source of truth.
function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;

  // Route a new state to the controlling caller when there is one, otherwise keep it locally.
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
    },
    [setOpenProp, open],
  );

  // Flip between the two widths.
  const toggleSidebar = React.useCallback(() => setOpen((open) => !open), [setOpen]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, toggleSidebar }),
    [state, open, setOpen, toggleSidebar],
  );

  return (
    <LocalSidebarProvider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </LocalSidebarProvider>
  );
}

type SidebarProps = React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "icon" | "none";
  containerClassName?: string;
  animateOnHover?: boolean;
  isResizing?: boolean;
  transition?: Transition;
};

// Render the sidebar column: a spacer that owns the layout width and a positioned container
// that holds the content and hosts the highlight that follows the pointer.
function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  className,
  children,
  animateOnHover = true,
  containerClassName,
  isResizing = false,
  transition = { type: "spring", stiffness: 350, damping: 35 },
  ...props
}: SidebarProps) {
  const { state } = useSidebar();

  if (collapsible === "none") {
    return (
      <Highlight
        enabled={animateOnHover}
        hover
        controlledItems
        mode="parent"
        containerClassName={containerClassName}
        transition={transition}
      >
        <div
          data-slot="sidebar"
          className={cn(
            "bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </Highlight>
    );
  }

  return (
    <div
      className="group peer text-sidebar-foreground"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-resizing={isResizing}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap in the layout. The transition is dropped while
          the seam is being dragged, so the edge stays under the pointer instead of trailing
          it, and for reduced-motion users. */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-400 ease-[cubic-bezier(0.7,-0.15,0.25,1.15)]",
          "group-data-[resizing=true]:transition-none motion-reduce:transition-none",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width) transition-[left,right,width] duration-400 ease-[cubic-bezier(0.75,0,0.25,1)]",
          "group-data-[resizing=true]:transition-none motion-reduce:transition-none",
          side === "left" ? "left-0" : "right-0",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className,
        )}
        {...props}
      >
        <Highlight
          containerClassName={cn("size-full", containerClassName)}
          enabled={animateOnHover}
          hover
          controlledItems
          mode="parent"
          forceUpdateBounds
          transition={transition}
        >
          <div
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
            className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
          >
            {children}
          </div>
        </Highlight>
      </div>
    </div>
  );
}

type SidebarInsetProps = React.ComponentProps<"main">;

// Render the content column beside the sidebar.
function SidebarInset({ className, ...props }: SidebarInsetProps) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "peer-data-[variant=inset]:m-2 peer-data-[variant=inset]:ml-0 peer-data-[variant=inset]:rounded-xl peer-data-[variant=inset]:shadow-sm peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className,
      )}
      {...props}
    />
  );
}

type SidebarHeaderProps = React.ComponentProps<"div">;

// Render the block above the scrollable sidebar content.
function SidebarHeader({ className, ...props }: SidebarHeaderProps) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

type SidebarFooterProps = React.ComponentProps<"div">;

// Render the block pinned below the scrollable sidebar content.
function SidebarFooter({ className, ...props }: SidebarFooterProps) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

type SidebarContentProps = React.ComponentProps<"div">;

// Render the scrollable middle region of the sidebar.
function SidebarContent({ className, ...props }: SidebarContentProps) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

type SidebarGroupProps = React.ComponentProps<"div">;

// Group related sidebar entries.
function SidebarGroup({ className, ...props }: SidebarGroupProps) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

type SidebarGroupLabelProps = React.ComponentProps<"div"> & {
  asChild?: boolean;
};

// Title one group, folding itself away while the sidebar shows icons only.
function SidebarGroupLabel({ className, asChild = false, ...props }: SidebarGroupLabelProps) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-300 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

type SidebarGroupActionProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
};

// Render the single action a group may offer next to its label.
function SidebarGroupAction({ className, asChild = false, ...props }: SidebarGroupActionProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

type SidebarGroupContentProps = React.ComponentProps<"div">;

// Wrap the body of one group.
function SidebarGroupContent({ className, ...props }: SidebarGroupContentProps) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

type SidebarMenuProps = React.ComponentProps<"ul">;

// Render one list of sidebar entries.
function SidebarMenu({ className, ...props }: SidebarMenuProps) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

type SidebarMenuItemProps = React.ComponentProps<"li">;

// Render one row of a sidebar menu.
function SidebarMenuItem({ className, ...props }: SidebarMenuItemProps) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

const sidebarMenuButtonActiveVariants = cva(
  "bg-sidebar-accent text-sidebar-accent-foreground rounded-md",
  {
    variants: {
      variant: {
        default: "bg-sidebar-accent text-sidebar-accent-foreground",
        outline:
          "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&:not([data-highlight])]:data-[state=open]:hover:bg-sidebar-accent [&:not([data-highlight])]:data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "[&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground [&:not([data-highlight])]:hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type SidebarMenuButtonProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
} & VariantProps<typeof sidebarMenuButtonVariants>;

// Render one sidebar entry and register it with the highlight group, so hovering it moves the
// highlight here. An entry that carries `data-highlight` styles its own hover through the
// moving highlight; without it, the static hover classes above take over.
function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  className,
  ...props
}: SidebarMenuButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <HighlightItem activeClassName={sidebarMenuButtonActiveVariants({ variant })}>
      <Comp
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    </HighlightItem>
  );
}

type SidebarMenuActionProps = React.ComponentProps<"button"> & {
  asChild?: boolean;
  showOnHover?: boolean;
};

// Render the secondary action of one entry, such as a row menu.
function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: SidebarMenuActionProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "z-[1] text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 opacity-0",
        className,
      )}
      {...props}
    />
  );
}

type SidebarMenuBadgeProps = React.ComponentProps<"div">;

// Render the count or status marker of one entry.
function SidebarMenuBadge({ className, ...props }: SidebarMenuBadgeProps) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

type SidebarMenuSubProps = React.ComponentProps<"ul">;

// Render the nested list of one entry, hidden while the sidebar shows icons only.
function SidebarMenuSub({ className, ...props }: SidebarMenuSubProps) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

type SidebarMenuSubItemProps = React.ComponentProps<"li">;

// Render one row of a nested list.
function SidebarMenuSubItem({ className, ...props }: SidebarMenuSubItemProps) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  );
}

type SidebarMenuSubButtonProps = React.ComponentProps<"a"> & {
  asChild?: boolean;
  size?: "sm" | "md";
  isActive?: boolean;
};

// Render one entry of a nested list and register it with the highlight group.
function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: SidebarMenuSubButtonProps) {
  const Comp = asChild ? Slot.Root : "a";

  return (
    <HighlightItem activeClassName="bg-sidebar-accent text-sidebar-accent-foreground rounded-md">
      <Comp
        data-slot="sidebar-menu-sub-button"
        data-sidebar="menu-sub-button"
        data-size={size}
        data-active={isActive}
        className={cn(
          "text-sidebar-foreground ring-sidebar-ring [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
          size === "sm" && "text-xs",
          size === "md" && "text-sm",
          "group-data-[collapsible=icon]:hidden",
          className,
        )}
        {...props}
      />
    </HighlightItem>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  useSidebar,
};
