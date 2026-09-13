import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppSettingsDto } from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings, updateSettings } from "@/lib/ipc/settings";
import { SettingsNotificationsRoute } from "./settings-notifications-route";
import { resetSettingsStore, useSettingsStore } from "./settings-store";
import { createSettingsSnapshot } from "./settings-test-fixture";

/** Replace persistence with isolated public IPC responses. */
vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));

/** Expose an IPC completion without native access or timer assumptions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(
    /** Capture one deferred completion. */ (yes) => {
      resolve = yes;
    },
  );
  return { promise, resolve };
}

/** Give each test a fresh backend snapshot and store lifecycle. */
beforeEach(() => {
  resetSettingsStore();
  vi.mocked(getSettings).mockReset().mockResolvedValue(createSettingsSnapshot());
  vi.mocked(updateSettings).mockReset();
});

/** Remove listeners and pending store generations after each page. */
afterEach(() => {
  cleanup();
  resetSettingsStore();
});

/** Never substitute checked defaults for an unresolved first read. */
it("shows loading without invented policy controls", () => {
  vi.mocked(getSettings).mockReturnValue(new Promise(/** Keep initialization pending. */ () => {}));
  render(<SettingsNotificationsRoute />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading notification settings…");
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.getByText("Always on")).toBeInTheDocument();
});

/** Initialization failure offers a read retry and never displays fake settings. */
it("retries a failed initial read", async () => {
  vi.mocked(getSettings).mockRejectedValueOnce(
    new IpcCallError("get_settings", { code: "unavailable" }),
  );
  const user = userEvent.setup();
  render(<SettingsNotificationsRoute />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load notification settings.",
  );
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("switch", { name: "Events and reminders" })).toBeChecked();
});

/** Corrupt and unauthorized snapshots expose safe recovery copy without writes. */
it.each(["corrupt_stored_settings", "unauthorized_window"])(
  "does not offer edits for %s",
  async (code) => {
    vi.mocked(getSettings).mockRejectedValueOnce(new IpcCallError("get_settings", { code }));
    render(<SettingsNotificationsRoute />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Restart XWork.");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(vi.mocked(updateSettings)).not.toHaveBeenCalled();
  },
);

/** Turning the master off preserves persisted OS selections through re-enable and keyboard edits. */
it("retains OS choices while the terminal switch is off and toggles by keyboard", async () => {
  const off = createSettingsSnapshot({}, {}, { terminalActivityEnabled: false });
  vi.mocked(getSettings).mockResolvedValueOnce(off);
  vi.mocked(updateSettings).mockResolvedValueOnce(createSettingsSnapshot());
  const user = userEvent.setup();
  render(<SettingsNotificationsRoute />);
  const terminal = await screen.findByRole("switch", { name: "Terminal and AI CLI activity" });
  const needsInput = screen.getByRole("checkbox", { name: "Needs input" });
  expect(terminal).not.toBeChecked();
  expect(needsInput).toBeChecked();
  expect(needsInput).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Process finished" })).not.toBeChecked();
  await user.tab();
  expect(terminal).toHaveFocus();
  await user.keyboard(" ");
  await waitFor(
    /** Wait for the committed master value to unlock its choices. */ () =>
      expect(needsInput).toBeEnabled(),
  );
  expect(terminal).toHaveFocus();
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
    notifications: { terminalActivityEnabled: true },
  });
  await user.tab();
  expect(needsInput).toHaveFocus();
  vi.mocked(updateSettings).mockResolvedValueOnce(
    createSettingsSnapshot(
      {},
      {},
      {
        terminalOsStates: {
          needsInput: false,
          processFinished: false,
          processExitedWithError: true,
        },
      },
    ),
  );
  await user.keyboard(" ");
  expect(updateSettings).toHaveBeenLastCalledWith({
    notifications: {
      terminalOsStates: { needsInput: false, processFinished: false, processExitedWithError: true },
    },
  });
});

/** All OS states may be off and every atomic patch includes the three backend fields. */
it("accepts all three OS states off without changing reminder policy", async () => {
  vi.mocked(getSettings).mockResolvedValueOnce(
    createSettingsSnapshot(
      {},
      {},
      {
        terminalOsStates: {
          needsInput: false,
          processFinished: false,
          processExitedWithError: true,
        },
      },
    ),
  );
  vi.mocked(updateSettings).mockResolvedValueOnce(
    createSettingsSnapshot(
      {},
      {},
      {
        terminalOsStates: {
          needsInput: false,
          processFinished: false,
          processExitedWithError: false,
        },
      },
    ),
  );
  const user = userEvent.setup();
  render(<SettingsNotificationsRoute />);
  await user.click(await screen.findByRole("checkbox", { name: "Process exited with an error" }));
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
    notifications: {
      terminalOsStates: {
        needsInput: false,
        processFinished: false,
        processExitedWithError: false,
      },
    },
  });
  for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Events and reminders" })).toBeChecked();
});

/** The controls show only committed policy and block duplicate input until persistence settles. */
it("locks controls while saving and adopts the committed response", async () => {
  const write = deferred<AppSettingsDto>();
  vi.mocked(updateSettings).mockReturnValueOnce(write.promise);
  const user = userEvent.setup();
  render(<SettingsNotificationsRoute />);
  const reminders = await screen.findByRole("switch", { name: "Events and reminders" });
  await user.click(reminders);
  expect(screen.getByRole("status")).toHaveTextContent("Saving notification settings…");
  expect(reminders).toBeChecked();
  for (const control of [...screen.getAllByRole("switch"), ...screen.getAllByRole("checkbox")])
    expect(control).toBeDisabled();
  await act(
    /** Settle persistence with the backend-owned disabled policy. */ async () =>
      write.resolve(createSettingsSnapshot({}, {}, { eventRemindersEnabled: false })),
  );
  expect(reminders).not.toBeChecked();
  expect(reminders).toBeEnabled();
});

/** Retry reconciles unknown outcomes before a separate explicit user edit is admitted. */
it("reloads after uncertain writes without blindly repeating the mutation", async () => {
  vi.mocked(updateSettings).mockRejectedValueOnce(new Error("sensitive transport error"));
  const user = userEvent.setup();
  render(<SettingsNotificationsRoute />);
  await user.click(await screen.findByRole("switch", { name: "Events and reminders" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save notification settings.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("sensitive");
  expect(screen.getByRole("switch", { name: "Events and reminders" })).toBeDisabled();
  vi.mocked(getSettings).mockResolvedValueOnce(
    createSettingsSnapshot({}, {}, { eventRemindersEnabled: false }),
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(updateSettings).toHaveBeenCalledOnce();
  expect(screen.getByRole("switch", { name: "Events and reminders" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Events and reminders" })).toBeEnabled();
});

/** Focus reconciles backend changes and cleanup removes the route's listener. */
it("refreshes on focus and disables controls during the Data barrier", async () => {
  const view = render(<SettingsNotificationsRoute />);
  await screen.findByRole("switch", { name: "Events and reminders" });
  vi.mocked(getSettings).mockResolvedValueOnce({
    ...createSettingsSnapshot({}, {}, { eventRemindersEnabled: false }),
    revision: "2",
  });
  await act(
    /** Reconcile one externally changed policy snapshot. */ async () => fireEvent.focus(window),
  );
  expect(screen.getByRole("switch", { name: "Events and reminders" })).not.toBeChecked();
  await act(
    /** Hold the shared maintenance admission barrier. */ async () =>
      useSettingsStore.getState().settleBeforeDataChange(),
  );
  expect(screen.getByRole("switch", { name: "Events and reminders" })).toBeDisabled();
  view.unmount();
  fireEvent.focus(window);
  expect(getSettings).toHaveBeenCalledTimes(2);
});
