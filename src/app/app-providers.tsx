import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QuitDialog } from "./quit-dialog";

// Compose the application-level providers and hosts the shell needs exactly once: the shared
// tooltip timing context and the single Quit confirmation dialog.
export function AppProviders(props: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {props.children}
      <QuitDialog />
    </TooltipProvider>
  );
}
