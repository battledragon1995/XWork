import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NoteDto } from "@/bindings/notes";
import type { ProjectDto } from "@/bindings/projects/projects";
import * as ipc from "@/lib/ipc/notes";
import * as projects from "@/lib/ipc/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import type { NotesOwner } from "./notes-provider";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { QuickNoteComposer } from "./quick-note-composer";
import { note, noteMocks, NotesTestHost } from "./notes-test-fixture";
/** Isolate persistence. */
vi.mock("@/lib/ipc/notes");
/** Isolate project reads. */
vi.mock("@/lib/ipc/projects");
/** Reset independent fixture snapshots. */
beforeEach(() => {
  vi.clearAllMocks();
  noteMocks();
});
/** Release mounted consumers. */
afterEach(cleanup);
/** Mount the real retained state and navigation seam. */
function mount() {
  return render(
    <MemoryRouter>
      <NotesTestHost>
        <QuickNoteComposer
          suspended={false}
          readSuspended={/** Admit isolated UI actions. */ () => false}
        />
      </NotesTestHost>
    </MemoryRouter>,
  );
}
/** Expose the documented accessible capture controls. */
it("renders title, Markdown, project, Save and Cancel", () => {
  mount();
  expect(screen.getByLabelText("Title (optional)")).toBeInTheDocument();
  expect(screen.getByLabelText("Markdown")).toBeInTheDocument();
  expect(screen.getByLabelText("Project")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
});
/** Verbatim input becomes exactly one acknowledged create and an explicit navigation link. */
it("saves raw Markdown once, clears fields and opens the acknowledged id", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: " title " } });
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "\n# body\n\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("link", { name: "Open note" })).toHaveAttribute(
    "href",
    "/notes?noteId=n&view=active",
  );
  expect(ipc.createNote).toHaveBeenCalledExactlyOnceWith({
    title: " title ",
    contentMarkdown: "\n# body\n\n",
    projectId: null,
  });
  expect(screen.getByLabelText("Markdown")).toHaveValue("");
  expect(screen.getByLabelText("Title (optional)")).toHaveValue("");
});
/** Empty and whitespace body validation keeps focus on the editable body. */
it.each(["", " \n "])("rejects empty Markdown %j", (content) => {
  mount();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: content } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("Write a note before saving.")).toHaveAttribute("role", "alert");
  expect(screen.getByLabelText("Markdown")).toHaveFocus();
  expect(ipc.createNote).not.toHaveBeenCalled();
});
/** Title validation counts Unicode scalars and rejects both C0 and C1 control ranges. */
it.each(["😀".repeat(256), "bad\u0001", "bad\u007f", "bad\u0085", "bad\u009f"])(
  "rejects invalid title %#",
  (value) => {
    mount();
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value } });
    fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Title (optional)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Title (optional)")).toHaveFocus();
    expect(ipc.createNote).not.toHaveBeenCalled();
  },
);
/** Backend normalization remains authoritative for accepted optional titles. */
it.each(["", "   ", `  ${"😀".repeat(255)}  `])(
  "preserves accepted title normalization %#",
  async (value) => {
    mount();
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value } });
    fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("link", { name: "Open note" });
    expect(ipc.createNote).toHaveBeenCalledWith({
      title: value || null,
      contentMarkdown: "body",
      projectId: null,
    });
  },
);
/** Byte limits accept the exact UTF-8 boundary and reject one scalar beyond it. */
it.each([false, true])("enforces UTF-8 body boundary overflow=%s", async (overflow) => {
  mount();
  const content = "😀".repeat(262144) + (overflow ? "é" : "");
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: content } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  if (overflow) {
    expect(screen.getByText("Keep Markdown within 1 MiB.")).toBeInTheDocument();
    expect(ipc.createNote).not.toHaveBeenCalled();
  } else {
    await screen.findByRole("link", { name: "Open note" });
    expect(ipc.createNote).toHaveBeenCalledWith({
      title: null,
      contentMarkdown: content,
      projectId: null,
    });
  }
});
/** Cancel clears manual fields without persistence or deletion. */
it("cancels without a backend write", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "draft" } });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.click(cancel);
  expect(screen.getByLabelText("Markdown")).toHaveValue("");
  expect(screen.getByLabelText("Markdown")).toHaveFocus();
  expect(ipc.createNote).not.toHaveBeenCalled();
  expect(ipc.moveNoteToTrash).not.toHaveBeenCalled();
});
/** IME and title Enter do not accidentally submit a manual capture. */
it("requires explicit Save after IME commitment", async () => {
  mount();
  const body = screen.getByLabelText("Markdown");
  fireEvent.compositionStart(body);
  fireEvent.change(body, { target: { value: "body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.keyDown(screen.getByLabelText("Title (optional)"), { key: "Enter" });
  expect(ipc.createNote).not.toHaveBeenCalled();
  fireEvent.compositionEnd(body);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Open note" });
});
/** Unknown outcomes remain copyable and require Cancel before another create intent. */
it("locks uncertain input and does not replay on focus or Refresh", async () => {
  vi.mocked(ipc.createNote).mockRejectedValue(new IpcCallError("create_note", null));
  mount();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "maybe saved" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Open Notes" });
  expect(screen.getByLabelText("Markdown")).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.focus(window);
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "new" } });
  expect(screen.getByLabelText("Markdown")).toHaveValue("maybe saved");
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/This only discards the local draft/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Markdown")).toHaveValue("");
});
/** Known failures preserve input and admit only a deliberate second Save. */
it("allows explicit recovery from a typed error", async () => {
  vi.mocked(ipc.createNote).mockRejectedValueOnce(
    new IpcCallError("create_note", { code: "persistence_failed" }),
  );
  mount();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Markdown")).toHaveValue("body");
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Open note" });
  expect(ipc.createNote).toHaveBeenCalledTimes(2);
});
/** Deferred projects never prevent an unlinked capture, and failed reads have explicit recovery. */
it("keeps No project usable during loading and errors", async () => {
  const pending = deferred<ProjectDto[]>();
  vi.mocked(projects.listProjects).mockReturnValue(pending.promise);
  mount();
  expect(screen.getByText("Loading projects…")).toBeInTheDocument();
  expect(screen.getByLabelText("Project")).toBeEnabled();
  await act(async () => pending.reject(new Error("offline")));
  expect(await screen.findByRole("button", { name: "Refresh projects" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Open note" });
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
});
/** Removed selected projects remain explicit until the user chooses another identity. */
it("retains a missing project and permits No project recovery", async () => {
  let owner!: NotesOwner;
  render(
    <MemoryRouter>
      <NotesTestHost
        capture={
          /** Capture the owner for fixture input. */ (value) => {
            owner = value;
          }
        }
      >
        <QuickNoteComposer
          suspended={false}
          readSuspended={/** Admit fixture actions. */ () => false}
        />
      </NotesTestHost>
    </MemoryRouter>,
  );
  act(() => owner.editQuickNote({ projectId: "gone", contentMarkdown: "body" }));
  expect(screen.getByRole("option", { name: "Project unavailable" })).toBeInTheDocument();
  vi.mocked(ipc.createNote).mockRejectedValueOnce(
    new IpcCallError("create_note", { code: "project_not_found" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Project")).toHaveValue("gone");
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Open note" });
  expect(ipc.createNote).toHaveBeenLastCalledWith({
    title: null,
    contentMarkdown: "body",
    projectId: null,
  });
});
/** Double clicks freeze fields and late acknowledgements cannot steal navigation focus. */
it("freezes one create and leaves external focus intact", async () => {
  const pending = deferred<NoteDto>();
  vi.mocked(ipc.createNote).mockReturnValue(pending.promise);
  mount();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByLabelText("Markdown")).toBeDisabled();
  document.body.tabIndex = -1;
  document.body.focus();
  await act(async () => pending.resolve(note));
  expect(document.body).toHaveFocus();
  expect(ipc.createNote).toHaveBeenCalledTimes(1);
  document.body.removeAttribute("tabindex");
});
/** Synchronous app admission protects stale renders for both Save and Cancel. */
it("checks live suspension before mutations", () => {
  let suspended = false;
  render(
    <MemoryRouter>
      <NotesTestHost>
        <QuickNoteComposer
          suspended={false}
          readSuspended={/** Read the latest external barrier. */ () => suspended}
        />
      </NotesTestHost>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "body" } });
  suspended = true;
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(ipc.createNote).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Markdown")).toHaveValue("body");
});
/** Control async completion without native timing or resources. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>(
    /** Capture isolated completion callbacks. */ (yes, no) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}
