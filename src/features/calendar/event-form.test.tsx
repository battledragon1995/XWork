import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { EventForm } from "./event-form";
import { newEventDraft } from "./event-form-state";
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate picker metadata. */ () => ({ listProjects: vi.fn(), onProjectsChanged: vi.fn() }),
);
/** Admit the standalone form within an isolated stable lifetime. */
function admitted() {
  return true;
}
/** Exercise the actual controlled fields instead of a static draft mock. */
function Harness() {
  const [draft, setDraft] = useState(newEventDraft("2026-09-09", "p", "Asia/Bangkok"));
  return (
    <EventForm
      draft={draft}
      errors={{}}
      disabled={false}
      saving={false}
      admitted={admitted}
      onChange={setDraft}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}
beforeEach(
  /** Restore the native metadata fixture. */ () => {
    vi.resetAllMocks();
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
  },
);
afterEach(/** Release picker effects after each test. */ () => cleanup());
it("offers all fields, recurrence modes and multiple removable reminders", /** Exercise the editable definition without delivery state. */ async () => {
  render(<Harness />);
  expect(await screen.findByText("No projects available")).toBeVisible();
  expect(screen.getByLabelText("Description")).toBeVisible();
  expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Bangkok");
  fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "weekly" } });
  expect(screen.getByLabelText("Wednesday")).toBeChecked();
  fireEvent.change(screen.getByLabelText("Repeat ends"), { target: { value: "on_date" } });
  expect(screen.getByLabelText("Repeat end date")).toHaveValue("2026-09-09");
  fireEvent.change(screen.getByLabelText("Repeat ends"), { target: { value: "after_count" } });
  expect(screen.getByLabelText("Occurrence count")).toHaveValue(1);
  fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
  fireEvent.change(screen.getByLabelText("Reminder 2 preset"), { target: { value: "60" } });
  expect(screen.getByLabelText("Reminder 2 minutes")).toHaveValue(60);
  fireEvent.click(screen.getByRole("button", { name: "Remove reminder 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove reminder 1" }));
  expect(screen.getByText("No reminders")).toBeVisible();
});
it("keeps timed values across all-day toggles", /** Preserve wall times without timezone conversion. */ async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:15" } });
  fireEvent.click(screen.getByLabelText("All day"));
  expect(screen.getByLabelText("Last day")).toHaveValue("2026-09-09");
  expect(screen.queryByLabelText("Start time")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("All day"));
  expect(screen.getByLabelText("Start time")).toHaveValue("14:15");
});
it("retries rejected project reads without unlinking the draft", /** Preserve the explicit project selection while metadata is unavailable. */ async () => {
  vi.mocked(listProjects).mockRejectedValue(new Error("offline"));
  render(<Harness />);
  expect(await screen.findByRole("button", { name: "Retry projects" })).toBeVisible();
  expect(screen.getByLabelText("Project")).toHaveValue("p");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep draft" } });
  vi.mocked(listProjects).mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Retry projects" }));
  expect(await screen.findByText("No projects available")).toBeVisible();
  expect(screen.getByLabelText("Project")).toHaveValue("p");
  expect(screen.getByLabelText("Title")).toHaveValue("Keep draft");
});
