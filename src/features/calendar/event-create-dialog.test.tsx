import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarEventDto } from "@/bindings/calendar";
import { createCalendarEvent } from "@/lib/ipc/calendar";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { EventCreateDialog } from "./event-create-dialog";

vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate create persistence. */ () => ({ createCalendarEvent: vi.fn() }),
);
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate picker reads and subscriptions. */ () => ({
    listProjects: vi.fn(),
    onProjectsChanged: vi.fn(),
  }),
);
const committed = { id: "created", title: "Meeting" } as CalendarEventDto;
const boundary = { epoch: 0, suspended: false };
let live = { ...boundary };
const created = vi.fn();
const close = vi.fn();
const focus = vi.fn();
/** Read a controllable synchronous lifecycle boundary. */
function readBoundary() {
  return live;
}
/** Mount a single prefilled create lifetime. */
function mount() {
  return render(
    <EventCreateDialog
      date="2026-09-09"
      projectId="p"
      boundary={boundary}
      readBoundary={readBoundary}
      onCreated={created}
      onClose={close}
      restoreFocus={focus}
    />,
  );
}
/** Type a valid title and deliberately submit the native form. */
function save() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Meeting" } });
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
}
beforeEach(
  /** Reset isolated mutation and picker fixtures. */ () => {
    vi.resetAllMocks();
    live = { ...boundary };
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
    vi.mocked(createCalendarEvent).mockResolvedValue(committed);
  },
);
afterEach(/** Release modal and subscription lifetimes. */ () => cleanup());

it("prefills date/project, focuses Title and publishes committed create once", /** Open the backend-issued ID after explicit Save. */ async () => {
  mount();
  expect(screen.getByLabelText("Title")).toHaveFocus();
  expect(screen.getByLabelText("Starts")).toHaveValue("2026-09-09");
  expect(screen.getByLabelText("Project")).toHaveValue("p");
  save();
  await waitFor(
    /** Observe the committed acknowledgement. */ () =>
      expect(created).toHaveBeenCalledExactlyOnceWith(committed),
  );
  expect(createCalendarEvent).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "p", reminderMinutesBefore: [10] }),
  );
});
it("focuses invalid fields and suppresses IME submission", /** Keep composition confirmation from creating an event. */ async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Title")).toHaveFocus();
  const title = screen.getByLabelText("Title");
  fireEvent.change(title, { target: { value: "Meeting" } });
  fireEvent.compositionStart(title);
  fireEvent.submit(title.closest("form") as HTMLFormElement);
  expect(createCalendarEvent).not.toHaveBeenCalled();
  fireEvent.compositionEnd(title);
  fireEvent.submit(title.closest("form") as HTMLFormElement);
  await waitFor(/** Await the admitted save. */ () => expect(created).toHaveBeenCalledOnce());
});
it("confirms dirty discard and keeps the intact draft on cancellation", /** Avoid implicit save or draft loss on Escape. */ async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Title")).toHaveValue("Draft");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(close).toHaveBeenCalledOnce();
  expect(createCalendarEvent).not.toHaveBeenCalled();
});
it("locks double submission and retires late results after unmount", /** Never navigate or focus from a retired mutation. */ async () => {
  let resolve!: (event: CalendarEventDto) => void;
  vi.mocked(createCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold the native acknowledgement. */ (done) => {
        resolve = done;
      },
    ),
  );
  const view = mount();
  save();
  fireEvent.submit(screen.getByLabelText("Title").closest("form") as HTMLFormElement);
  expect(createCalendarEvent).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  view.unmount();
  focus.mockClear();
  await act(/** Release the retired mutation. */ async () => resolve(committed));
  expect(created).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
});
it("denies dispatch and response publication ahead of rendered maintenance", /** Apply live admission on both sides of await. */ async () => {
  mount();
  live.suspended = true;
  save();
  expect(createCalendarEvent).not.toHaveBeenCalled();
  live.suspended = false;
  let resolve!: (event: CalendarEventDto) => void;
  vi.mocked(createCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold a valid in-flight write. */ (done) => {
        resolve = done;
      },
    ),
  );
  save();
  live = { epoch: 1, suspended: false };
  await act(/** Complete after the operation epoch changed. */ async () => resolve(committed));
  expect(created).not.toHaveBeenCalled();
});
it("allows typed field recovery but blocks uncertain create retry", /** Never duplicate a possibly committed create. */ async () => {
  vi.mocked(createCalendarEvent)
    .mockRejectedValueOnce(new IpcCallError("create", { kind: "invalid_title" }))
    .mockRejectedValueOnce(new Error("transport"));
  mount();
  save();
  expect(await screen.findByText("Enter a valid title of 1–200 characters.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save event" })).toBeEnabled();
  save();
  expect(await screen.findByText(/result is unknown/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText("Title").closest("form") as HTMLFormElement);
  expect(createCalendarEvent).toHaveBeenCalledTimes(2);
});
it("cleans a late project subscription without changing the retired form", /** Release native resources after delayed setup. */ async () => {
  let resolve!: (cleanup: () => void) => void;
  const unlisten = vi.fn();
  vi.mocked(onProjectsChanged).mockReturnValue(
    new Promise(
      /** Delay listener setup beyond unmount. */ (done) => {
        resolve = done;
      },
    ),
  );
  const view = mount();
  view.unmount();
  await act(/** Deliver the late cleanup handle. */ async () => resolve(unlisten));
  expect(unlisten).toHaveBeenCalledOnce();
});
