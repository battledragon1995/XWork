import { expect, it } from "vitest";
import { IpcCallError } from "./ipc-error";
import { reminderErrorCode, reminderErrorMessage } from "./reminder-error";

// Map recovery categories without exposing native transport details.
it("provides safe reminder recovery copy", () => {
  for (const [code, copy] of [
    ["delivery_not_found", "This reminder is no longer available."],
    ["target_unavailable", "This reminder is no longer available."],
    ["delivery_changed", "This reminder changed. Refresh and try again."],
    ["action_not_allowed", "This reminder changed. Refresh and try again."],
    ["scheduler_catching_up", "Loading missed reminders…"],
    ["persistence_failed", "Reminders are temporarily unavailable. Try again."],
    ["clock_out_of_range", "Check your system clock, then try again."],
  ]) {
    const error = new IpcCallError("reminder", { code: code ?? "" });
    expect(reminderErrorCode(error)).toBe(code);
    expect(reminderErrorMessage(error)).toBe(copy);
  }
  expect(reminderErrorCode(new Error("secret"))).toBeUndefined();
  expect(reminderErrorMessage(new Error("secret"))).toBe(
    "Couldn't update reminders. Refresh and try again.",
  );
  expect(
    reminderErrorMessage(new IpcCallError("reminder", { code: "invalid_cursor" })),
  ).not.toContain("invalid_cursor");
});
