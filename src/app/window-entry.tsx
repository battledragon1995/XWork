import { RouterProvider } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QuickNoteWindow } from "@/features/notes/quick-note-window";
import { AppearanceThemeSync } from "@/features/settings/appearance-theme-sync";
import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";

/** Select native capture before constructing any main router or owner. */
export function createWindowEntry(search: string): React.JSX.Element {
  if (new URLSearchParams(search).get("window") === "quick-note") {
    return (
      <TooltipProvider>
        <AppearanceThemeSync />
        <QuickNoteWindow />
      </TooltipProvider>
    );
  }
  return (
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  );
}
