import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitFileChangeDto,
  GitFileChangeKindDto,
  GitHeadDto,
  ProjectGitStatusDto,
} from "@/bindings/projects/projects";
import { ProjectGitChanges } from "./project-git-changes";

afterEach(() => {
  cleanup();
});

/** Build one worktree snapshot while allowing a test to replace its head and rows. */
function snapshot(
  head: GitHeadDto | null,
  changes: GitFileChangeDto[],
  changedCount = changes.length,
): ProjectGitStatusDto {
  return {
    summary: {
      projectId: "3f2a",
      repositoryKind: "worktree",
      head,
      changedCount,
      untrackedCount: changes.filter((change) => change.change === "untracked").length,
    },
    changes,
  };
}

/** Build one change row with the fields irrelevant to its badge held constant. */
function change(kind: GitFileChangeKindDto, path = `${kind}.txt`): GitFileChangeDto {
  return { path, previousPath: null, change: kind, isDirectory: false };
}

describe("ProjectGitChanges", () => {
  // Verify every generated kind has its specified visual badge and accessible full name.
  it("renders all eight change badges", () => {
    const cases = [
      ["added", "A", "Added"],
      ["modified", "M", "Modified"],
      ["deleted", "D", "Deleted"],
      ["renamed", "R", "Renamed"],
      ["copied", "C", "Copied"],
      ["typeChanged", "T", "Type changed"],
      ["untracked", "??", "Untracked"],
      ["conflicted", "U", "Conflicted"],
    ] as const;
    render(
      <ProjectGitChanges
        snapshot={snapshot(
          { kind: "branch", name: "main" },
          cases.map(([kind]) => change(kind)),
        )}
      />,
    );

    const list = screen.getByRole("list");
    for (const [, letter, name] of cases) {
      expect(within(list).getByText(letter)).toHaveAttribute("aria-hidden", "true");
      expect(within(list).getByText(`${name}:`)).toHaveClass("sr-only");
    }
  });

  // Verify rename/copy paths and an untracked directory are rendered verbatim from the DTO.
  it("renders previous paths and preserves the directory suffix", () => {
    render(
      <ProjectGitChanges
        snapshot={snapshot({ kind: "branch", name: "main" }, [
          {
            path: "src/new.ts",
            previousPath: "src/old.ts",
            change: "renamed",
            isDirectory: false,
          },
          change("untracked", "fixtures/"),
        ])}
      />,
    );

    expect(screen.getByText("src/old.ts → src/new.ts")).toBeInTheDocument();
    expect(screen.getByText("fixtures/")).toBeInTheDocument();
  });

  // Verify branch, unborn, and detached heads produce the three documented labels.
  it.each([
    [{ kind: "branch", name: "main" }, "Changes on main (0)"],
    [{ kind: "unborn", name: "trunk" }, "Changes on trunk (0)"],
    [{ kind: "detached", shortOid: "a1b2c3d" }, "Changes on a1b2c3d (0)"],
  ] as const)("labels the block for head %o", (head, label) => {
    render(<ProjectGitChanges snapshot={snapshot(head, [], 0)} />);

    expect(screen.getByRole("heading", { level: 2, name: label })).toBeInTheDocument();
  });

  // Verify the clean state still carries the zero count and permanent read-only note.
  it("renders the clean state and read-only footer", () => {
    render(<ProjectGitChanges snapshot={snapshot({ kind: "branch", name: "main" }, [], 0)} />);

    expect(screen.getByText("Working tree is clean.")).toBeInTheDocument();
    expect(
      screen.getByText("Read-only. Commit, checkout and push happen in your terminal."),
    ).toBeInTheDocument();
  });

  // Verify the component gates non-worktree snapshots rather than inventing a change block.
  it("renders nothing for a non-repository snapshot", () => {
    const notRepository = snapshot(null, [], 0);
    notRepository.summary.repositoryKind = "notRepository";

    const view = render(<ProjectGitChanges snapshot={notRepository} />);

    expect(view.container).toBeEmptyDOMElement();
  });

  // Verify a long backend list is rendered in full with no pagination or truncation.
  it("renders every row in a long list", () => {
    const changes = Array.from({ length: 120 }, (_, index) =>
      change("modified", `file-${index}.ts`),
    );
    render(<ProjectGitChanges snapshot={snapshot({ kind: "branch", name: "main" }, changes)} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(120);
  });
});
