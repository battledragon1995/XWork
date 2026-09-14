import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as notes from "@/lib/ipc/notes";
import * as projects from "@/lib/ipc/projects";
import * as native from "@/lib/ipc/quick-note-window";
import { note } from "./notes-test-fixture";
import { QuickNoteWindow } from "./quick-note-window";

/** Isolate persistence and native state. */
vi.mock("@/lib/ipc/notes");
/** Isolate project enumeration. */
vi.mock("@/lib/ipc/projects");
/** Isolate native window calls. */
vi.mock("@/lib/ipc/quick-note-window");
/** Restore independent async defaults. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(projects.listProjects).mockResolvedValue([]);
  vi.mocked(notes.createNote).mockResolvedValue(note);
  vi.mocked(native.closeQuickNoteWindow).mockResolvedValue();
  vi.mocked(native.startQuickNoteWindowDrag).mockResolvedValue();
});
/** Release renderer-owned effects. */
afterEach(cleanup);
/** Mount after initial project hydration. */
async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<QuickNoteWindow />);
  });
  return view;
}
/** Type capture text without triggering persistence. */
function body(value = "\n# body\n") {
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value } });
}
/** Expose an explicitly controlled native acknowledgement. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(
    /** Capture the test resolver. */ (done) => {
      resolve = done;
    },
  );
  return { promise, resolve };
}
/** Body admission is manual and moves focus to invalid text. */
it("validates required body and title controls before creating", async () => {
  await mount();
  expect(screen.getByLabelText("Markdown")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Write a note");
  body();
  fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "bad\u007f" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("Title (optional)")).toHaveFocus();
  expect(notes.createNote).not.toHaveBeenCalled();
});
/** Synchronous admission blocks repeated Save and every cancellation during creation. */
it("sends raw text once and waits for acknowledgement before close", async () => {
  const pending = deferred<typeof note>();
  vi.mocked(notes.createNote).mockReturnValue(pending.promise);
  await mount();
  body();
  fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: " title " } });
  const save = screen.getByRole("button", { name: "Save" });
  act(
    /** Race actions before native acknowledgement. */ () => {
      fireEvent.click(save);
      fireEvent.click(save);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.keyDown(screen.getByLabelText("Markdown"), { key: "Escape" });
    },
  );
  expect(notes.createNote).toHaveBeenCalledExactlyOnceWith({
    title: " title ",
    contentMarkdown: "\n# body\n",
    projectId: null,
  });
  expect(native.closeQuickNoteWindow).not.toHaveBeenCalled();
  await act(async () => pending.resolve(note));
  expect(native.closeQuickNoteWindow).toHaveBeenCalledTimes(1);
});
/** Retained commit identity prevents duplicate creation after native close rejection. */
it("retries only close after a successful save", async () => {
  vi.mocked(native.closeQuickNoteWindow).mockRejectedValueOnce(new Error("close"));
  await mount();
  body();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Note saved, but");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry Close" })));
  expect(notes.createNote).toHaveBeenCalledTimes(1);
  expect(native.closeQuickNoteWindow).toHaveBeenCalledTimes(2);
});
/** Unknown creation cannot be replayed while typed rejection retains editable input. */
it.each([true, false])("handles known creation failure %s without closing", async (known) => {
  vi.mocked(notes.createNote).mockRejectedValue(
    new IpcCallError("create_note", known ? { code: "persistence_failed" } : null),
  );
  await mount();
  body();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Markdown")).toHaveValue("\n# body\n");
  expect(native.closeQuickNoteWindow).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Markdown") as HTMLTextAreaElement).readOnly).toBe(!known);
  if (!known) expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
/** Native destruction retires the renderer without issuing a stale close. */
it("ignores save acknowledgement after unmount", async () => {
  const pending = deferred<typeof note>();
  vi.mocked(notes.createNote).mockReturnValue(pending.promise);
  const view = await mount();
  body();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  view.unmount();
  await act(async () => pending.resolve(note));
  expect(native.closeQuickNoteWindow).not.toHaveBeenCalled();
});
/** IME Save and Escape stay local until composition ends. */
it("guards composition and preserves the draft on failed Cancel", async () => {
  vi.mocked(native.closeQuickNoteWindow).mockRejectedValueOnce(new Error("close"));
  await mount();
  body();
  const input = screen.getByLabelText("Markdown");
  fireEvent.compositionStart(input);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.keyDown(input, { key: "Escape" });
  expect(notes.createNote).not.toHaveBeenCalled();
  expect(native.closeQuickNoteWindow).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(await screen.findByRole("alert")).toHaveTextContent("draft is still here");
  expect(input).toHaveValue("\n# body\n");
});
/** Failed choices do not block unlinked capture or erase input on refresh. */
it("recovers project loading without replacing capture", async () => {
  vi.mocked(projects.listProjects).mockRejectedValueOnce(new Error("projects"));
  await mount();
  body();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load projects");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh projects" })));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("Markdown")).toHaveValue("\n# body\n");
});
/** A removed project remains selected until explicit user correction. */
it("retains removed project identity and forwards the chosen project", async () => {
  vi.mocked(projects.listProjects).mockResolvedValueOnce([
    { id: "p", displayName: "Project", availability: { status: "available" } } as ProjectDto,
  ]);
  await mount();
  body();
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p" } });
  vi.mocked(notes.createNote).mockRejectedValueOnce(
    new IpcCallError("create_note", { code: "project_not_found" }),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh projects" })));
  expect(screen.getByLabelText("Project")).toHaveValue("p");
  expect(screen.getByRole("option", { name: "Project unavailable" })).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(notes.createNote).toHaveBeenCalledWith({
    title: "",
    contentMarkdown: "\n# body\n",
    projectId: "p",
  });
});
/** Drag failure is recoverable and interactive controls never start dragging. */
it("delegates primary titlebar drag while preserving input on failure", async () => {
  vi.mocked(native.startQuickNoteWindowDrag).mockRejectedValueOnce(new Error("drag"));
  await mount();
  body();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Close Quick Note" }), {
    button: 0,
    isPrimary: true,
  });
  expect(native.startQuickNoteWindowDrag).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Quick Note" }), {
    button: 1,
    isPrimary: true,
  });
  expect(native.startQuickNoteWindowDrag).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Quick Note" }), {
    button: 0,
    isPrimary: true,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not move the window");
  expect(screen.getByLabelText("Markdown")).toHaveValue("\n# body\n");
});
