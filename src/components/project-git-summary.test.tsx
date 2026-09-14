import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectGitSummaryDto } from "@/bindings/projects/projects";
import { getProjectGitSummary } from "@/lib/ipc/projects";
import { ProjectGitSummary } from "./project-git-summary";

/** Isolate Git inspection from the user's repositories. */
vi.mock("@/lib/ipc/projects", () => ({ getProjectGitSummary: vi.fn() }));
/** Retire effects and mock state after each render. */
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const summary: ProjectGitSummaryDto = {
  projectId: "p",
  repositoryKind: "worktree",
  head: { kind: "branch", name: "main" },
  changedCount: 2,
  untrackedCount: 1,
};
/** Show real branch and counts from the existing compact query. */
it("renders repository metadata without requesting detailed file status", async () => {
  vi.mocked(getProjectGitSummary).mockResolvedValue(summary);
  render(<ProjectGitSummary projectId="p" />);
  expect(await screen.findByText("main")).toBeInTheDocument();
  expect(screen.getByText("· 2 changed")).toBeInTheDocument();
  expect(getProjectGitSummary).toHaveBeenCalledWith("p");
});
/** A late read must never bring old project information back after maintenance. */
it("retires a pending response when its boundary becomes suspended", async () => {
  let resolve!: (value: ProjectGitSummaryDto) => void;
  vi.mocked(getProjectGitSummary).mockImplementation(
    /** Hold the isolated query until after the boundary update. */ () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<ProjectGitSummary projectId="p" />);
  view.rerender(<ProjectGitSummary projectId="p" suspended epoch={1} />);
  await act(async () => {
    resolve(summary);
  });
  expect(screen.queryByText("main")).toBeNull();
});
