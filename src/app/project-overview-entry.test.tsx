import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectOverviewEntry } from "./project-overview-entry";
/** The overview owner supplies only its verified project identity. */
vi.mock("@/features/projects/project-overview-route", () => ({
  ProjectOverviewRoute: ({
    renderLinkedNotes,
    renderLinkedEvents,
  }: {
    renderLinkedNotes(id: string): React.ReactNode;
    renderLinkedEvents(id: string): React.ReactNode;
  }) => (
    <>
      {renderLinkedNotes("verified-id")}
      {renderLinkedEvents("verified-id")}
    </>
  ),
}));
/** Observe the public projection boundary without accessing Notes internals. */
vi.mock("@/features/notes", () => ({
  ProjectNotesSection: ({ projectId }: { projectId: string }) => <output>{projectId}</output>,
}));
/** App composition forwards the exact loaded identity. */
it("composes linked Notes with the verified project ID", () => {
  render(<ProjectOverviewEntry />);
  expect(screen.getByText("verified-id")).toBeVisible();
  expect(screen.getByText("Calendar for verified-id")).toBeVisible();
});

/** Keep application admission isolated from native provider initialization. */
vi.mock("./calendar-entry", () => ({
  useCalendarBoundary: /** Supply a stable public admission contract. */ () => ({
    boundary: { suspended: false, epoch: 0 },
    readBoundary: /** Read the current admission snapshot. */ () => ({
      suspended: false,
      epoch: 0,
    }),
  }),
}));
/** Calendar receives only the same identity authenticated by Project Overview. */
vi.mock("@/features/calendar", () => ({
  ProjectCalendarSection: /** Render only the injected verified identity. */ ({
    projectId,
  }: {
    projectId: string;
  }) => <output>Calendar for {projectId}</output>,
}));
