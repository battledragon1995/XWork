import { createMemoryRouter, type Params } from "react-router";
import { HomeRoute } from "@/features/home/home-route";
import { AppErrorBoundary } from "./app-error-boundary";
import { AppShell } from "./app-shell";
import { AreaPlaceholder, NotFoundPlaceholder } from "./area-placeholder";

// Breadcrumb metadata a route contributes. Labels live in the route table so no store
// has to mirror them and so a later feature slice can keep them while replacing `element`.
export interface RouteCrumbHandle {
  crumbs(params: Readonly<Params<string>>): string[];
}

// Attach the breadcrumb labels of one route in the shape `useMatches` hands back.
function crumbs(build: RouteCrumbHandle["crumbs"]): RouteCrumbHandle {
  return { crumbs: build };
}

// Create the application router with in-memory history and the persistent shell layout.
// Later slices replace only the `element` of the route they own; they never touch the shell.
export function createAppRouter(initialEntries: string[] = ["/"]) {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        children: [
          {
            index: true,
            element: <HomeRoute />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Home"]),
          },
          {
            path: "projects",
            element: <AreaPlaceholder area="Projects" arrivesWith="FE-004" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Projects"]),
          },
          {
            path: "projects/:projectId",
            element: <AreaPlaceholder area="Project Overview" arrivesWith="FE-005" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs((params) => ["Projects", params.projectId ?? ""]),
          },
          {
            path: "notes",
            element: <AreaPlaceholder area="Notes" arrivesWith="FE-019" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Notes"]),
          },
          {
            path: "calendar",
            element: <AreaPlaceholder area="Calendar" arrivesWith="FE-021" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Calendar"]),
          },
          {
            path: "settings",
            element: <AreaPlaceholder area="Settings" arrivesWith="FE-011" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Settings"]),
          },
          {
            // Reserved for FE-006. The session id stays opaque, so it is echoed verbatim.
            path: "sessions/:sessionId",
            element: <AreaPlaceholder area="Session" arrivesWith="FE-006" />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs((params) => ["Session", params.sessionId ?? ""]),
          },
          {
            path: "*",
            element: <NotFoundPlaceholder />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Not found"]),
          },
        ],
      },
    ],
    { initialEntries },
  );
}
