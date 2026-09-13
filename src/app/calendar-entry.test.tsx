import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarRouteProps, EventCreateDialogProps } from "@/features/calendar";
import { CalendarEntry } from "./calendar-entry";
import { resetQuitStore, useQuitStore } from "./quit-store";

const owner = vi.hoisted(
  /** Keep a synchronous owner independent from React rendering. */ () => ({
    busy: false,
    invalidationEpoch: 0,
  }),
);
const capture = vi.hoisted(
  /** Capture the public component contract. */ () => ({
    props: null as CalendarRouteProps | null,
    create: null as EventCreateDialogProps | null,
  }),
);
vi.mock(
  "@/features/settings/data-management-provider",
  /** Supply a local public owner snapshot. */ () => ({
    useDataManagement: /** Read rendered and live owner state. */ () => ({
      ...owner,
      getCurrent: /** Read live admission. */ () => owner,
    }),
  }),
);
vi.mock(
  "@/features/calendar",
  /** Observe composition without starting feature reads. */ () => ({
    CalendarRoute: /** Record live props while preserving a real component lifetime. */ (
      props: CalendarRouteProps,
    ) => {
      capture.props = props;
      const location = useLocation();
      return (
        <>
          <output>{props.boundary?.suspended ? "paused" : "ready"}</output>
          <output data-testid="location">{location.search}</output>
        </>
      );
    },
    EventCreateDialog:
      /** Observe the composed create contract without invoking native persistence. */ (
        props: EventCreateDialogProps,
      ) => {
        capture.create = props;
        return (
          <output>
            create {props.date} {props.projectId}
          </output>
        );
      },
  }),
);
beforeEach(
  /** Reset isolated owner state. */ () => {
    owner.busy = false;
    owner.invalidationEpoch = 0;
    resetQuitStore();
    capture.create = null;
  },
);
afterEach(
  /** Release subscriptions. */ () => {
    cleanup();
    resetQuitStore();
  },
);
/** The Calendar owner receives both render updates and admission ahead of React. */
it("composes live maintenance, epochs, and Quit boundaries", () => {
  const view = render(
    <MemoryRouter>
      <CalendarEntry />
    </MemoryRouter>,
  );
  expect(screen.getByText("ready")).toBeVisible();
  owner.busy = true;
  owner.invalidationEpoch = 2;
  expect(capture.props?.readBoundary?.()).toEqual({ suspended: true, epoch: 2 });
  view.rerender(
    <MemoryRouter>
      <CalendarEntry />
    </MemoryRouter>,
  );
  expect(screen.getByText("paused")).toBeVisible();
  owner.busy = false;
  act(/** Suspend the UI for Quit. */ () => useQuitStore.setState({ phase: "requesting" }));
  expect(capture.props?.readBoundary?.()).toEqual({ suspended: true, epoch: 2 });
  act(
    /** Permit recovery after a failed snapshot. */ () =>
      useQuitStore.setState({ phase: "snapshot-failed" }),
  );
  expect(screen.getByText("ready")).toBeVisible();
});

/** Compose real selected-day/project input and the authoritative returned event ID. */
it("opens creation and replaces only the event intent on success", () => {
  render(
    <MemoryRouter
      initialEntries={["/calendar?date=2026-09-09&project=p&event=old&occurrence=old-context"]}
    >
      <CalendarEntry />
    </MemoryRouter>,
  );
  act(
    /** Deliver the route's verified creation intent. */ () =>
      capture.props?.onCreateEvent?.({ date: "2026-09-10", projectId: "p" }),
  );
  expect(screen.getByText("create 2026-09-10 p")).toBeVisible();
  expect(screen.getByTestId("location").textContent).not.toContain("event=");
  expect(screen.getByTestId("location").textContent).not.toContain("occurrence=");
  act(
    /** Publish an acknowledged event outside the currently visible range. */ () =>
      capture.create?.onCreated({ id: "committed-outside" } as Parameters<
        EventCreateDialogProps["onCreated"]
      >[0]),
  );
  expect(screen.getByTestId("location").textContent).toContain("event=committed-outside");
  expect(screen.getByTestId("location").textContent).not.toContain("occurrence=");
  expect(screen.getByTestId("location").textContent).toContain("project=p");
  expect(screen.getByTestId("location").textContent).toContain("date=2026-09-10");
  expect(screen.queryByText("create 2026-09-10 p")).not.toBeInTheDocument();
});

/** Stop creation and success callbacks when maintenance or Quit owns the live boundary. */
it("retires create drafts and refuses stale success navigation", () => {
  const view = render(
    <MemoryRouter>
      <CalendarEntry />
    </MemoryRouter>,
  );
  owner.busy = true;
  act(
    /** Try admission before React sees maintenance. */ () =>
      capture.props?.onCreateEvent?.({ date: "2026-09-09", projectId: null }),
  );
  expect(capture.create).toBeNull();
  owner.busy = false;
  act(
    /** Open one live form. */ () =>
      capture.props?.onCreateEvent?.({ date: "2026-09-09", projectId: null }),
  );
  const old = capture.create;
  owner.invalidationEpoch = 1;
  act(
    /** Deliver an obsolete committed response. */ () =>
      old?.onCreated({ id: "retired" } as Parameters<EventCreateDialogProps["onCreated"]>[0]),
  );
  expect(screen.getByTestId("location").textContent).not.toContain("retired");
  view.rerender(
    <MemoryRouter>
      <CalendarEntry />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/create 2026/)).not.toBeInTheDocument();
  act(
    /** Begin Quit after the draft was retired. */ () =>
      useQuitStore.setState({ phase: "requesting" }),
  );
  act(
    /** Cancel Quit without resurrecting retired edits. */ () =>
      useQuitStore.setState({ phase: "idle" }),
  );
  expect(screen.queryByText(/create 2026/)).not.toBeInTheDocument();
});
