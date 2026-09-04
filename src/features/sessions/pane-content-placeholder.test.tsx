import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaneContentPlaceholder } from "./pane-content-placeholder";
import { createCliProfileDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("PaneContentPlaceholder", () => {
  // Verify each deferred union member names the feature that will render it.
  it("renders exact deferred content copy", () => {
    const { rerender } = render(
      <PaneContentPlaceholder
        content={{ kind: "toolSelection", profileId: "builtin:codex", title: "Codex" }}
        profiles={[createCliProfileDto()]}
      />,
    );
    expect(screen.getByText("Codex is ready to run.")).toBeInTheDocument();
    rerender(
      <PaneContentPlaceholder
        content={{
          kind: "terminal",
          terminalId: "terminal-1",
          profileId: "builtin:codex",
          title: "Codex",
        }}
        profiles={[]}
      />,
    );
    expect(screen.getByText("Terminals arrive with FE-008.")).toBeInTheDocument();
    rerender(
      <PaneContentPlaceholder
        content={{ kind: "file", fileHandleId: "file-1", title: "README" }}
        profiles={[]}
      />,
    );
    expect(screen.getByText("File panes arrive with FE-017.")).toBeInTheDocument();
  });
});
