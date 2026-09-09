import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarRouteProps } from "@/features/calendar";
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
      return <output>{props.boundary?.suspended ? "paused" : "ready"}</output>;
    },
  }),
);
beforeEach(
  /** Reset isolated owner state. */ () => {
    owner.busy = false;
    owner.invalidationEpoch = 0;
    resetQuitStore();
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
  const view = render(<CalendarEntry />);
  expect(screen.getByText("ready")).toBeVisible();
  owner.busy = true;
  owner.invalidationEpoch = 2;
  expect(capture.props?.readBoundary?.()).toEqual({ suspended: true, epoch: 2 });
  view.rerender(<CalendarEntry />);
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
