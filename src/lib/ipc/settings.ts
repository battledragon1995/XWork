import type { AppSettingsDto, SettingsError, UpdateSettingsDto } from "@/bindings/settings";
import { invokeCommand } from "./ipc-error";

/** Read the complete settings snapshot through the shared typed command boundary. */
export function getSettings(): Promise<AppSettingsDto> {
  return invokeCommand<AppSettingsDto, SettingsError>("get_settings");
}

/** Persist one atomic partial settings update and return the whole replacement snapshot. */
export function updateSettings(input: UpdateSettingsDto): Promise<AppSettingsDto> {
  return invokeCommand<AppSettingsDto, SettingsError>("update_settings", { input });
}

/** Reset every Appearance field to the built-in default theme. */
export function restoreAppearanceDefaults(): Promise<AppSettingsDto> {
  return invokeCommand<AppSettingsDto, SettingsError>("restore_appearance_defaults");
}
