import {
  Bell,
  CircleHelp,
  Database,
  Keyboard,
  type LucideIcon,
  Palette,
  SlidersHorizontal,
  SquareTerminal,
} from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils/cn";

/** Metadata shared by Settings navigation and application route composition. */
export interface SettingsSectionDefinition {
  label: string;
  slug: string;
  path: string;
  icon: LucideIcon;
  owner: "FE-011" | "FE-012" | "FE-013" | "FE-014" | "FE-015" | "FE-023";
}

/** Single source of labels, paths, icons, ordering, and deferred feature ownership. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    label: "General",
    slug: "general",
    path: "/settings/general",
    icon: SlidersHorizontal,
    owner: "FE-011",
  },
  {
    label: "Appearance",
    slug: "appearance",
    path: "/settings/appearance",
    icon: Palette,
    owner: "FE-012",
  },
  {
    label: "Terminal & CLI Profiles",
    slug: "terminal-profiles",
    path: "/settings/terminal-profiles",
    icon: SquareTerminal,
    owner: "FE-013",
  },
  {
    label: "Keyboard Shortcuts",
    slug: "keyboard-shortcuts",
    path: "/settings/keyboard-shortcuts",
    icon: Keyboard,
    owner: "FE-014",
  },
  {
    label: "Notifications",
    slug: "notifications",
    path: "/settings/notifications",
    icon: Bell,
    owner: "FE-023",
  },
  {
    label: "Data",
    slug: "data",
    path: "/settings/data",
    icon: Database,
    owner: "FE-015",
  },
  {
    label: "About",
    slug: "about",
    path: "/settings/about",
    icon: CircleHelp,
    owner: "FE-011",
  },
];

/** Render the labelled Settings link list without adding a second navigation landmark. */
export function SettingsNav() {
  return (
    <div className="h-full overflow-y-auto border-r border-hairline px-3 py-6">
      <div className="px-2 pb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
        Settings
      </div>
      <ul aria-label="Settings sections" className="space-y-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.path}>
              <NavLink
                to={section.path}
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center gap-2.5 rounded-sm px-2 text-[13px] font-medium whitespace-nowrap text-body outline-none hover:bg-surface-card focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "bg-surface-card text-ink",
                  )
                }
              >
                <Icon aria-hidden="true" className="size-[15px] shrink-0 text-muted" />
                <span>{section.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
