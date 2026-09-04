import type { SettingsError } from "@/bindings/settings";

/** Display-ready classification of one failed settings read. */
export interface SettingsFailure {
  kind: "retryable" | "integration";
  message: string;
}

/** The two Appearance colour groups a backend field path can belong to. */
export type AppearanceErrorGroup = "interfaceColors" | "terminalPalette";

/** Display-ready classification of one failed Appearance write. */
export interface SettingsSaveFailure {
  message: string;
  retryable: boolean;
  retainsDraft: boolean;
  group: AppearanceErrorGroup | null;
  field: string | null;
}

/** Message shown whenever the failure means the two layers disagree about the contract. */
const INTEGRATION_MESSAGE = "XWork ran into a settings integration problem. Restart XWork.";

/** Message shown when the stored settings themselves cannot be trusted. */
const CORRUPT_MESSAGE = "XWork couldn't read its saved settings. Restart XWork.";

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
        message: CORRUPT_MESSAGE,
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
        message: INTEGRATION_MESSAGE,
      };
  }
}

/**
 * Resolve which colour group a backend field path belongs to. An unrecognized path keeps
 * the page-level alert only, so a future field can never be attached to the wrong group.
 */
export function readAppearanceErrorGroup(field: string): AppearanceErrorGroup | null {
  if (field.startsWith("interfaceColors.")) {
    return "interfaceColors";
  }
  if (field.startsWith("terminalPalette.")) {
    return "terminalPalette";
  }
  return null;
}

/**
 * Classify one failed Appearance write. `null` stands for a rejection that carried no
 * recognized code, which is always treated as an integration failure with no retry.
 */
export function classifySettingsSaveFailure(error: SettingsError | null): SettingsSaveFailure {
  if (error === null) {
    return {
      message: INTEGRATION_MESSAGE,
      retryable: false,
      retainsDraft: false,
      group: null,
      field: null,
    };
  }

  switch (error.code) {
    case "invalid_color":
      return {
        message: `XWork couldn't save ${error.field}. Use a #rrggbb colour.`,
        retryable: false,
        retainsDraft: true,
        group: readAppearanceErrorGroup(error.field),
        field: error.field,
      };
    case "contrast_too_low":
      return {
        message: `XWork couldn't save ${error.foreground} on ${error.background}. Pick a pair with more contrast.`,
        retryable: false,
        retainsDraft: true,
        group: readAppearanceErrorGroup(error.foreground),
        field: error.foreground,
      };
    case "value_out_of_range":
      return {
        message: `XWork couldn't save ${error.field}. Use a value between ${error.min} and ${error.max}.`,
        retryable: false,
        retainsDraft: false,
        group: null,
        field: error.field,
      };
    case "persistence_failed":
      return {
        message: "XWork couldn't save your appearance settings to storage.",
        retryable: true,
        retainsDraft: true,
        group: null,
        field: null,
      };
    case "unavailable":
      return {
        message: "XWork couldn't save your appearance settings right now.",
        retryable: true,
        retainsDraft: true,
        group: null,
        field: null,
      };
    case "corrupt_stored_settings":
      return {
        message: CORRUPT_MESSAGE,
        retryable: false,
        retainsDraft: false,
        group: null,
        field: null,
      };
    case "unauthorized_window":
    case "empty_patch":
    case "invalid_preset_combination":
      return {
        message: INTEGRATION_MESSAGE,
        retryable: false,
        retainsDraft: false,
        group: null,
        field: null,
      };
  }
}
