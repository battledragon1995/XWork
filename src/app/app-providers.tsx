import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppearanceThemeSync } from "@/features/settings/appearance-theme-sync";
import { QuitDialog } from "./quit-dialog";

// Compose the application-level providers and hosts the shell needs exactly once: the shared
// tooltip timing context, the single Quit confirmation dialog, and the one writer of the
// window-wide Appearance theme. The theme host reads store state only; the startup settings
// read lives in `main.tsx` so mounting the providers in a test triggers no command.
export function AppProviders(props: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppearanceThemeSync />
      {props.children}
      <QuitDialog />
    </TooltipProvider>
  );
}
