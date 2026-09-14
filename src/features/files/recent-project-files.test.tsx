import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { listRecentFiles } from "@/lib/ipc/files";
import { RecentProjectFiles } from "./recent-project-files";

/** Keep recent-file queries away from real app data. */
vi.mock("@/lib/ipc/files", () => ({ listRecentFiles: vi.fn() }));
/** Release foreground listeners and fixture responses. */
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
/** The overview displays only backend-provided recent paths and availability. */
it("renders a bounded recent-file projection", async () => {
  vi.mocked(listRecentFiles).mockResolvedValue([
    {
      projectId: "p",
      name: "README.md",
      parentPath: "docs",
      relativePath: "docs/README.md",
      openedAtMs: 1n,
      availability: "available",
      isOpen: false,
      hasUnsavedChanges: false,
    },
  ]);
  render(
    <RecentProjectFiles
      projectId="p"
      boundary={{ suspended: false, epoch: 0 }}
      readBoundary={/** Admit the isolated read. */ () => ({ suspended: false, epoch: 0 })}
    />,
  );
  expect(await screen.findByText("README.md")).toBeVisible();
  expect(listRecentFiles).toHaveBeenCalledWith("p", 5);
});
/** Suspended app work must not start a new recent-file read. */
it("does not read files while maintenance owns the app", () => {
  render(
    <RecentProjectFiles
      projectId="p"
      boundary={{ suspended: true, epoch: 1 }}
      readBoundary={/** Keep the test boundary suspended. */ () => ({ suspended: true, epoch: 1 })}
    />,
  );
  expect(listRecentFiles).not.toHaveBeenCalled();
});
