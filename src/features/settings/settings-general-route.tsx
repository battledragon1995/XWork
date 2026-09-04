import type { GeneralSettingsDto } from "@/bindings/settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { classifySettingsFailure } from "./settings-error-copy";
import { SettingRow, SettingsSection } from "./settings-section";
import { useSettingsStore } from "./settings-store";

/** English display names for every currently supported interface language. */
const LANGUAGE_LABELS: Record<GeneralSettingsDto["interfaceLanguage"], string> = {
  english: "English",
};

/** Read-only boolean rows owned by the backend lifecycle contract. */
const BOOLEAN_ROWS: ReadonlyArray<{
  field: keyof Pick<
    GeneralSettingsDto,
    "closeToTray" | "showTrayIcon" | "askBeforeQuitting" | "openAtHomeOnLaunch"
  >;
  label: string;
  description: string;
}> = [
  {
    field: "closeToTray",
    label: "Closing the window hides XWork to the tray",
    description:
      "Terminals, AI CLIs and reminders keep running. Use Quit XWork to stop everything.",
  },
  {
    field: "showTrayIcon",
    label: "Show tray icon",
    description: "Turning this off means the window can only be reopened from the taskbar.",
  },
  {
    field: "askBeforeQuitting",
    label: "Ask before quitting",
    description: "Shows how many sessions and processes will be stopped.",
  },
  {
    field: "openAtHomeOnLaunch",
    label: "Open at Home on launch",
    description: "XWork always opens at Home. Sessions are not restored after Quit.",
  },
];

/** Render the five General values supplied by the retained settings snapshot. */
function GeneralRows(props: { general: GeneralSettingsDto }) {
  return (
    <div>
      <SettingRow
        first
        label="Interface language"
        description="More languages will arrive in a later release."
      >
        <span className="text-[13px] font-medium text-body-strong">
          {LANGUAGE_LABELS[props.general.interfaceLanguage]}
        </span>
      </SettingRow>
      {BOOLEAN_ROWS.map((row) => (
        <SettingRow key={row.field} label={row.label} description={row.description}>
          <Switch
            aria-label={row.label}
            checked={props.general[row.field]}
            disabled
            tabIndex={-1}
          />
        </SettingRow>
      ))}
    </div>
  );
}

/** Render the read-only General page across loading, ready, and classified failure states. */
export function SettingsGeneralRoute() {
  const status = useSettingsStore((state) => state.status);
  const snapshot = useSettingsStore((state) => state.snapshot);
  const errorCode = useSettingsStore((state) => state.errorCode);
  const load = useSettingsStore((state) => state.load);
  const failure = errorCode === null ? null : classifySettingsFailure(errorCode);

  return (
    <SettingsSection title="General" description="Language, window and tray behaviour.">
      {(status === "idle" || status === "loading") && (
        <p aria-busy="true" className="text-[13px] text-muted">
          Loading settings…
        </p>
      )}

      {status === "ready" && snapshot !== null && <GeneralRows general={snapshot.general} />}

      {status === "error" && failure !== null && (
        <div role="alert" className="flex max-w-[560px] flex-col items-start gap-3">
          <p className="text-[13px] text-error">{failure.message}</p>
          {failure.kind === "retryable" && (
            <Button type="button" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
