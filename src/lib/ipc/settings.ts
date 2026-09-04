import type { AppSettingsDto, SettingsError } from "@/bindings/settings";
import { invokeCommand } from "./ipc-error";

/** Read the complete settings snapshot through the shared typed command boundary. */
export function getSettings(): Promise<AppSettingsDto> {
  return invokeCommand<AppSettingsDto, SettingsError>("get_settings");
}
