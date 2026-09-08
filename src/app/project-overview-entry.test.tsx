import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectOverviewEntry } from "./project-overview-entry";
/** The overview owner supplies only its verified project identity. */
vi.mock("@/features/projects/project-overview-route", () => ({
  ProjectOverviewRoute: ({
    renderLinkedNotes,
  }: {
    renderLinkedNotes(id: string): React.ReactNode;
  }) => <>{renderLinkedNotes("verified-id")}</>,
}));
/** Observe the public projection boundary without accessing Notes internals. */
vi.mock("@/features/notes", () => ({
  ProjectNotesSection: ({ projectId }: { projectId: string }) => <output>{projectId}</output>,
}));
/** App composition forwards the exact loaded identity. */
it("composes linked Notes with the verified project ID", () => {
  render(<ProjectOverviewEntry />);
  expect(screen.getByText("verified-id")).toBeVisible();
});
