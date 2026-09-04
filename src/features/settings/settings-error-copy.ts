import type { SettingsError } from "@/bindings/settings";

/** Display-ready classification of one failed settings read. */
export interface SettingsFailure {
  kind: "retryable" | "integration";
  message: string;
}

/** Map every generated code, plus unknown failures, to an intentional recovery path. */
export function classifySettingsFailure(code: SettingsError["code"] | "unknown"): SettingsFailure {
  switch (code) {
    case "unavailable":
      return {
        kind: "retryable",
        message: "XWork couldn't read settings right now.",
      };
    case "persistence_failed":
      return {
        kind: "retryable",
        message: "XWork couldn't read settings from storage.",
      };
    case "corrupt_stored_settings":
      return {
        kind: "integration",
        message: "XWork couldn't read its saved settings. Restart XWork.",
      };
    case "unauthorized_window":
    case "empty_patch":
    case "invalid_color":
    case "contrast_too_low":
    case "value_out_of_range":
    case "invalid_preset_combination":
    case "unknown":
      return {
        kind: "integration",
        message: "XWork ran into a settings integration problem. Restart XWork.",
      };
  }
}
