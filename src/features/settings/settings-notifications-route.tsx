import { useEffect } from "react";
import type { CliOsNotificationStatesDto } from "@/bindings/settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { classifySettingsFailure } from "./settings-error-copy";
import { SettingRow, SettingsSection } from "./settings-section";
import { retainSettingsArea, useSettingsStore } from "./settings-store";

/** Backend-owned terminal states exposed as independent OS notification choices. */
const OS_STATES: ReadonlyArray<{ field: keyof CliOsNotificationStatesDto; label: string }> = [
  { field: "needsInput", label: "Needs input" },
  { field: "processFinished", label: "Process finished" },
  { field: "processExitedWithError", label: "Process exited with an error" },
];

/** Render durable notification policy controls using the shared Settings write owner. */
export function SettingsNotificationsRoute() {
  const state = useSettingsStore();
  const { load, commitNotifications } = state;
  useEffect(
    /** Refresh on entry and focus, keeping late reads owned by the retained store. */ () => {
      const release = retainSettingsArea();
      void load();
      /** Reconcile policy changes made while this route was out of focus. */
      const refresh = () => void load();
      window.addEventListener("focus", refresh);
      return /** Release this route's listener and retention without cancelling durable writes. */ () => {
        window.removeEventListener("focus", refresh);
        release();
      };
    },
    [load],
  );

  const policy = state.snapshot?.notifications;
  const loading = state.status === "idle" || state.status === "loading";
  const saving = state.notificationSaveStatus === "saving";
  const failedWrite = state.notificationSaveStatus === "error";
  const disabled = state.status !== "ready" || saving || failedWrite || state.dataChangeBlocked;
  const errorCode = state.status === "error" ? state.errorCode : state.notificationErrorCode;
  const failure = errorCode === null ? null : classifySettingsFailure(errorCode);
  const retryable = errorCode === "unknown" || failure?.kind === "retryable";

  return (
    <SettingsSection
      title="Notifications"
      description="Choose what appears in the bell and operating-system notifications."
    >
      <div aria-busy={loading || saving}>
        {loading && (
          <p role="status" className="text-[13px] text-muted">
            Loading notification settings…
          </p>
        )}
        {saving && (
          <p role="status" className="text-[13px] text-muted">
            Saving notification settings…
          </p>
        )}
        {failure && (
          <div role="alert" className="mb-3 flex flex-col items-start gap-3 text-[13px] text-error">
            <p>
              {state.status === "error"
                ? "Could not load notification settings."
                : "Could not save notification settings."}
            </p>
            {!retryable && <p>{failure.message}</p>}
            {retryable && (
              <>
                <p>Reload settings, then choose your change again.</p>
                <Button
                  variant="outline"
                  disabled={loading || state.dataChangeBlocked}
                  onClick={
                    /** Read the committed result before permitting another explicit edit. */ () =>
                      void load()
                  }
                >
                  Retry
                </Button>
              </>
            )}
          </div>
        )}
        {policy && (
          <>
            <SettingRow
              first
              label="Terminal and AI CLI activity"
              description="Show terminal activity in the bell. Choose which states can also notify the operating system below."
            >
              <Switch
                aria-label="Terminal and AI CLI activity"
                checked={policy.terminalActivityEnabled}
                disabled={disabled}
                onCheckedChange={
                  /** Persist only the terminal category switch. */ (terminalActivityEnabled) =>
                    void commitNotifications({ terminalActivityEnabled })
                }
              />
            </SettingRow>
            <fieldset
              className="mb-4 space-y-2 text-[13px]"
              disabled={disabled || !policy.terminalActivityEnabled}
              aria-describedby="terminal-os-help"
            >
              <legend className="mb-2 font-medium text-body-strong">
                Send to the operating system when
              </legend>
              {OS_STATES.map(
                /** Keep every OS choice bound to the current committed snapshot. */ ({
                  field,
                  label,
                }) => (
                  <label key={field} className="flex items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={policy.terminalOsStates[field]}
                      onChange={
                        /** Submit the complete atomic OS state selection from the latest snapshot. */ (
                          event,
                        ) => {
                          const current = useSettingsStore.getState().snapshot?.notifications;
                          if (current)
                            void commitNotifications({
                              terminalOsStates: {
                                ...current.terminalOsStates,
                                [field]: event.currentTarget.checked,
                              },
                            });
                        }
                      }
                    />
                    {label}
                  </label>
                ),
              )}
            </fieldset>
            <p id="terminal-os-help" className="mb-4 text-[12px] text-muted">
              Turn on terminal activity to change these choices. Turning it off keeps your
              selections.
            </p>
            <SettingRow
              label="Events and reminders"
              description="Show due reminders in the bell. Operating-system notifications appear when the event is not visible."
            >
              <Switch
                aria-label="Events and reminders"
                checked={policy.eventRemindersEnabled}
                disabled={disabled}
                onCheckedChange={
                  /** Persist only the reminder category switch. */ (eventRemindersEnabled) =>
                    void commitNotifications({ eventRemindersEnabled })
                }
              />
            </SettingRow>
            <p className="mb-4 text-[12px] text-muted">
              Turning this off keeps existing notifications and Missed reminders. Turning it back on
              applies to future reminders without sending a burst of past notifications.
            </p>
          </>
        )}
        <SettingRow
          label="Missed reminders on launch"
          description="After XWork reopens, reminders missed while it was closed appear in Calendar → Missed without an operating-system notification burst."
        >
          <span className="text-[13px] font-medium text-body-strong">Always on</span>
        </SettingRow>
      </div>
    </SettingsSection>
  );
}
