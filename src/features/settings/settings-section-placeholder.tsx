import { SettingsSection } from "./settings-section";

/** Name a deferred Settings section without presenting controls that do not work yet. */
export function SettingsSectionPlaceholder(props: { section: string; arrivesWith: string }) {
  return (
    <SettingsSection title={props.section} description={`Settings for ${props.section}.`}>
      <p className="max-w-[440px] text-[14px] text-body">
        This section arrives with {props.arrivesWith}.
      </p>
    </SettingsSection>
  );
}
