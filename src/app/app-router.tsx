import { createMemoryRouter, Navigate, type Params } from "react-router";
import { HomeRoute } from "@/features/home/home-route";
import { ProjectOverviewRoute } from "@/features/projects/project-overview-route";
import { ProjectsRoute } from "@/features/projects/projects-route";
import { readProjectCrumbLabel } from "@/features/projects/projects-store";
import { SettingsAboutRoute } from "@/features/settings/settings-about-route";
import { SettingsGeneralRoute } from "@/features/settings/settings-general-route";
import { SETTINGS_SECTIONS } from "@/features/settings/settings-nav";
import { SettingsRoute } from "@/features/settings/settings-route";
import { SettingsSectionPlaceholder } from "@/features/settings/settings-section-placeholder";
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

// Select the real FE-011 pages and keep every deferred owner explicit in its placeholder.
function settingsSectionElement(section: (typeof SETTINGS_SECTIONS)[number]) {
  if (section.slug === "general") {
    return <SettingsGeneralRoute />;
  }
  if (section.slug === "about") {
    return <SettingsAboutRoute />;
  }
  return <SettingsSectionPlaceholder section={section.label} arrivesWith={section.owner} />;
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
            element: <ProjectsRoute />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Projects"]),
          },
          {
            path: "projects/:projectId",
            element: <ProjectOverviewRoute />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs((params) => ["Projects", readProjectCrumbLabel(params.projectId)]),
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
            element: <SettingsRoute />,
            errorElement: <AppErrorBoundary />,
            handle: crumbs(() => ["Settings"]),
            children: [
              {
                index: true,
                element: <Navigate to="general" replace />,
                errorElement: <AppErrorBoundary />,
              },
              ...SETTINGS_SECTIONS.map((section) => ({
                path: section.slug,
                element: settingsSectionElement(section),
                errorElement: <AppErrorBoundary />,
                handle: crumbs(() => ["Settings", section.label]),
              })),
            ],
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
