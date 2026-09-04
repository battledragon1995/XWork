import { RotateCcw } from "lucide-react";
import type { AppearanceSettingsDto, InterfaceColorsDto, ThemeModeDto } from "@/bindings/settings";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AppearanceColorField } from "./appearance-color-field";
import type { ContrastViolation } from "./appearance-contrast";
import { AppearancePresetCards } from "./appearance-preset-cards";
import { AppearanceSegmented } from "./appearance-segmented";
import { AppearanceTerminalPreview } from "./appearance-terminal-preview";
import {
  type AppearanceErrorGroup,
  type SettingsSaveFailure,
  classifySettingsFailure,
  classifySettingsSaveFailure,
} from "./settings-error-copy";
import { SettingRow, SettingsSection } from "./settings-section";
import { useSettingsStore } from "./settings-store";
import { useAppearanceEditor } from "./use-appearance-editor";
import type { EffectiveColorScheme } from "./use-effective-color-scheme";

/** Page description taken verbatim from the wireframe. */
const PAGE_DESCRIPTION =
  "Theme, colours and text size. Changes preview live in the window behind this panel.";

/** The three theme modes, in wireframe order. */
const THEME_MODES: ReadonlyArray<{ value: ThemeModeDto; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** The two interface colour sets the user can edit, whichever one is being painted. */
const EDITED_SCHEMES: ReadonlyArray<{ value: EffectiveColorScheme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The four interface colours, in wireframe order. */
const INTERFACE_COLOR_KEYS: ReadonlyArray<{ key: keyof InterfaceColorsDto; label: string }> = [
  { key: "accent", label: "Accent" },
  { key: "canvas", label: "Canvas" },
  { key: "sidebar", label: "Sidebar" },
  { key: "text", label: "Text" },
];

/** Interface size bounds enforced by BE-008. */
const INTERFACE_FONT_MIN = 12;
const INTERFACE_FONT_MAX = 20;

/** Terminal size bounds enforced by BE-008. */
const TERMINAL_FONT_MIN = 10;
const TERMINAL_FONT_MAX = 24;

/** Human-readable names for the interface colour keys used in contrast messages. */
const INTERFACE_COLOR_LABELS: Record<string, string> = {
  accent: "Accent",
  canvas: "Canvas",
  sidebar: "Sidebar",
  text: "Text",
};

/** Turn one backend field path into the label the page shows beside its group. */
function readFieldLabel(field: string): string {
  const parts = field.split(".");
  if (parts[0] === "interfaceColors" && parts.length === 3) {
    const scheme = parts[1] === "dark" ? "Dark" : "Light";
    const key = parts[2] ?? "";
    return `${INTERFACE_COLOR_LABELS[key] ?? key} (${scheme})`;
  }
  if (field === "terminalPalette.background") {
    return "Background";
  }
  if (field === "terminalPalette.foreground") {
    return "Foreground";
  }
  return field;
}

/** Describe one locally detected contrast problem, naming the pair and the threshold. */
function readViolationMessage(violation: ContrastViolation): string {
  return `${readFieldLabel(violation.foregroundField)} on ${readFieldLabel(violation.backgroundField)} needs at least ${violation.required}:1 contrast. It is ${violation.actual.toFixed(2)}:1.`;
}

/** Render every message that belongs to one colour group, if there is anything to say. */
function GroupMessages(props: { messages: readonly string[] }) {
  if (props.messages.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1" role="alert">
      {props.messages.map((message) => (
        <p className="text-[12px] text-error" key={message}>
          {message}
        </p>
      ))}
    </div>
  );
}

/** Render the six Appearance rows over the drafted or committed snapshot value. */
function AppearanceRows(props: {
  appearance: AppearanceSettingsDto;
  saveFailure: SettingsSaveFailure | null;
}) {
  const editor = useAppearanceEditor(props.appearance);
  const appearance = editor.appearance;
  const colors = appearance.interfaceColors[editor.editedScheme];
  const palette = appearance.terminalPalette;

  /** Collect the local and backend messages that belong to one colour group. */
  const messagesFor = (group: AppearanceErrorGroup): string[] => {
    const prefix = group === "interfaceColors" ? "interfaceColors." : "terminalPalette.";
    const messages = editor.violations
      .filter((violation) => violation.foregroundField.startsWith(prefix))
      .map(readViolationMessage);
    if (props.saveFailure?.group === group) {
      messages.push(props.saveFailure.message);
    }
    return messages;
  };

  /** Show the backend colour rejection on the exact row it names, when it names one. */
  const backendFieldError = (field: string): string | undefined => {
    const failure = props.saveFailure;
    if (failure === null || failure.group === null) {
      return undefined;
    }
    return failure.field === field ? failure.message : undefined;
  };

  return (
    <div>
      <SettingRow description="Follow the operating system or pin one mode." first label="Theme">
        <AppearanceSegmented
          label="Theme"
          onChange={editor.setThemeMode}
          options={THEME_MODES}
          value={appearance.themeMode}
        />
      </SettingRow>

      <SettingRow
        description="Pick a starting point, then adjust colours below."
        label="Preset"
        layout="stacked"
      >
        <AppearancePresetCards onChange={editor.setPreset} value={appearance.themePreset} />
      </SettingRow>

      <SettingRow
        description="Accent is used for primary actions only."
        label="Interface colours"
        layout="stacked"
      >
        <div className="flex w-full min-w-0 flex-col gap-3">
          <AppearanceSegmented
            label="Interface colours scheme"
            onChange={editor.setEditedScheme}
            options={EDITED_SCHEMES}
            value={editor.editedScheme}
          />
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-6 gap-y-2">
            {INTERFACE_COLOR_KEYS.map((entry) => (
              <AppearanceColorField
                errorMessage={backendFieldError(
                  `interfaceColors.${editor.editedScheme}.${entry.key}`,
                )}
                key={entry.key}
                label={entry.label}
                onChange={(next) => editor.setInterfaceColor(entry.key, next)}
                onCommitNow={editor.flushPendingCommit}
                value={colors[entry.key]}
              />
            ))}
          </div>
          <GroupMessages messages={messagesFor("interfaceColors")} />
        </div>
      </SettingRow>

      <SettingRow
        description="Background, foreground and the 16 ANSI colours."
        label="Terminal palette"
        layout="stacked"
      >
        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-6 gap-y-2">
            <AppearanceColorField
              errorMessage={backendFieldError("terminalPalette.background")}
              label="Background"
              onChange={(next) => editor.setTerminalColor("background", next)}
              onCommitNow={editor.flushPendingCommit}
              value={palette.background}
            />
            <AppearanceColorField
              errorMessage={backendFieldError("terminalPalette.foreground")}
              label="Foreground"
              onChange={(next) => editor.setTerminalColor("foreground", next)}
              onCommitNow={editor.flushPendingCommit}
              value={palette.foreground}
            />
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-2">
            {palette.ansiColors.map((color, index) => (
              <AppearanceColorField
                errorMessage={backendFieldError(`terminalPalette.ansiColors.${index}`)}
                // ANSI slots are positional, so the index is their only stable identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: the ANSI index is the identity
                key={index}
                label={`ANSI ${index}`}
                onChange={(next) => editor.setTerminalColor(`ansi:${index}`, next)}
                onCommitNow={editor.flushPendingCommit}
                value={color}
              />
            ))}
          </div>
          <AppearanceTerminalPreview fontSizePx={appearance.terminalFontSizePx} palette={palette} />
          <GroupMessages messages={messagesFor("terminalPalette")} />
        </div>
      </SettingRow>

      <SettingRow label="Interface text size">
        <div className="flex w-full min-w-0 items-center gap-3">
          <span className="w-10 shrink-0 font-mono text-[12px] text-body">
            {appearance.interfaceFontSizePx} px
          </span>
          <Slider
            aria-label="Interface text size"
            max={INTERFACE_FONT_MAX}
            min={INTERFACE_FONT_MIN}
            onValueChange={(next) => editor.setInterfaceFontSizePx(next[0] ?? 0)}
            step={1}
            value={[appearance.interfaceFontSizePx]}
          />
        </div>
      </SettingRow>

      <SettingRow label="Terminal text size">
        <div className="flex w-full min-w-0 items-center gap-3">
          <span className="w-10 shrink-0 font-mono text-[12px] text-body">
            {appearance.terminalFontSizePx} px
          </span>
          <Slider
            aria-label="Terminal text size"
            max={TERMINAL_FONT_MAX}
            min={TERMINAL_FONT_MIN}
            onValueChange={(next) => editor.setTerminalFontSizePx(next[0] ?? 0)}
            step={1}
            value={[appearance.terminalFontSizePx]}
          />
        </div>
      </SettingRow>
    </div>
  );
}

/** Render the Appearance page across loading, read failure, ready and write failure states. */
export function SettingsAppearanceRoute() {
  const status = useSettingsStore((state) => state.status);
  const snapshot = useSettingsStore((state) => state.snapshot);
  const errorCode = useSettingsStore((state) => state.errorCode);
  const load = useSettingsStore((state) => state.load);
  const saveStatus = useSettingsStore((state) => state.saveStatus);
  const saveError = useSettingsStore((state) => state.saveError);
  const lastFailedPatch = useSettingsStore((state) => state.lastFailedPatch);
  const commitAppearance = useSettingsStore((state) => state.commitAppearance);
  const restoreAppearance = useSettingsStore((state) => state.restoreAppearance);

  const readFailure = errorCode === null ? null : classifySettingsFailure(errorCode);
  const saving = saveStatus === "saving";
  const saveFailure = saveStatus === "error" ? classifySettingsSaveFailure(saveError) : null;

  /** Repeat the exact operation that failed, which is either a patch or the restore. */
  const retrySave = () => {
    if (lastFailedPatch !== null) {
      void commitAppearance(lastFailedPatch);
      return;
    }
    void restoreAppearance();
  };

  return (
    <SettingsSection
      action={
        <div className="flex shrink-0 items-center gap-3">
          <span aria-live="polite" className="text-[12px] text-muted">
            {saving ? "Saving…" : ""}
          </span>
          <Button
            disabled={saving || status !== "ready"}
            onClick={() => void restoreAppearance()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <RotateCcw aria-hidden="true" />
            Restore default theme
          </Button>
        </div>
      }
      description={PAGE_DESCRIPTION}
      title="Appearance"
    >
      {saveFailure !== null && (
        <div
          className="mb-4 flex max-w-[560px] flex-col items-start gap-3 rounded-md border border-hairline p-3"
          role="alert"
        >
          <p className="text-[13px] text-error">{saveFailure.message}</p>
          {saveFailure.retryable && (
            <Button onClick={retrySave} size="sm" type="button" variant="outline">
              Try again
            </Button>
          )}
        </div>
      )}

      {(status === "idle" || status === "loading") && (
        <p aria-busy="true" className="text-[13px] text-muted">
          Loading settings…
        </p>
      )}

      {status === "ready" && snapshot !== null && (
        <AppearanceRows appearance={snapshot.appearance} saveFailure={saveFailure} />
      )}

      {status === "error" && readFailure !== null && (
        <div className="flex max-w-[560px] flex-col items-start gap-3" role="alert">
          <p className="text-[13px] text-error">{readFailure.message}</p>
          {readFailure.kind === "retryable" && (
            <Button onClick={() => void load()} type="button" variant="outline">
              Try again
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
