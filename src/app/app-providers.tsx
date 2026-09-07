import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileHandleProvider } from "@/features/files";
import { AppearanceThemeSync } from "@/features/settings/appearance-theme-sync";
import { TerminalProvider } from "@/features/terminal";
import { QuitDialog } from "./quit-dialog";

// Compose the application-level providers and hosts the shell needs exactly once: the shared
// tooltip timing context, the single Quit confirmation dialog, the one writer of the
// window-wide Appearance theme, and the two registries that outlive routes and panes. The
// theme host reads store state only; the startup settings read lives in `main.tsx` so
// mounting the providers in a test triggers no command.
export function AppProviders(props: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppearanceThemeSync />
      <TerminalProvider>
        <FileHandleProvider>{props.children}</FileHandleProvider>
      </TerminalProvider>
      <QuitDialog />
    </TooltipProvider>
  );
}
