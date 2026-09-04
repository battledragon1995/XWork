import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneContentPicker } from "./pane-content-picker";
import { createCliProfilesSnapshot, createToolCatalogData } from "./sessions-test-fixture";

afterEach(cleanup);

describe("PaneContentPicker", () => {
  // Verify catalog order, file deferral, and an available selection.
  it("renders and selects an available profile", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <PaneContentPicker
          catalog={createToolCatalogData()}
          selectingProfileId={null}
          isLocked={false}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "What goes here?" })).toBeInTheDocument();
    expect(screen.getByText("Files arrive with FE-016.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Codex/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Verify a missing catalog stays isolated to the picker and exposes retry.
  it("renders catalog loading and error states", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PaneContentPicker
          catalog={createToolCatalogData({ status: "loading", snapshot: null })}
          selectingProfileId={null}
          isLocked={false}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Loading your CLI profiles" })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <PaneContentPicker
          catalog={createToolCatalogData({
            status: "error",
            snapshot: null,
            failure: {
              operation: "load",
              code: "unknown",
              profileId: null,
              message: "XWork couldn't load your CLI profiles.",
              canRetry: true,
            },
          })}
          selectingProfileId={null}
          isLocked={false}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't load your CLI profiles.");
    expect(createCliProfilesSnapshot().profiles).toHaveLength(1);
  });
});
