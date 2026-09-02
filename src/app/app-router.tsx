import { createMemoryRouter } from "react-router";
import { AppShell } from "./app-shell";

// Create the application router with in-memory history and the root shell route.
export function createAppRouter(initialEntries: string[] = ["/"]) {
  return createMemoryRouter([{ path: "/", element: <AppShell /> }], {
    initialEntries,
  });
}
