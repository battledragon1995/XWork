import { create } from "zustand";
import type { AppSettingsDto, SettingsError } from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings } from "@/lib/ipc/settings";

/** Lifecycle of the retained settings snapshot. */
export type SettingsStatus = "idle" | "loading" | "ready" | "error";

/** Known backend code, or the marker for a malformed/transport rejection. */
export type SettingsErrorCode = SettingsError["code"] | "unknown";

/** Settings state shared by every child route in the Settings frame. */
export interface SettingsState {
  status: SettingsStatus;
  snapshot: AppSettingsDto | null;
  errorCode: SettingsErrorCode | null;
  load(): Promise<void>;
}

/** Recognized error codes emitted by the generated Settings contract. */
const SETTINGS_ERROR_CODES = new Set<SettingsError["code"]>([
  "unauthorized_window",
  "empty_patch",
  "invalid_color",
  "contrast_too_low",
  "value_out_of_range",
  "invalid_preset_combination",
  "corrupt_stored_settings",
  "persistence_failed",
  "unavailable",
]);

/** Number of mounted Settings frames currently allowed to receive a completion. */
let activeFrames = 0;

/** Generation that prevents an obsolete read from replacing newer state. */
let requestGeneration = 0;

/** Shared request used to collapse repeated loads and development remounts. */
let inFlight: Promise<void> | null = null;

/** Extract only a code that belongs to the generated settings error union. */
function readErrorCode(rejection: unknown): SettingsErrorCode {
  if (!(rejection instanceof IpcCallError) || rejection.payload === null) {
    return "unknown";
  }

  const code = rejection.payload.code;
  return SETTINGS_ERROR_CODES.has(code as SettingsError["code"])
    ? (code as SettingsError["code"])
    : "unknown";
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  status: "idle",
  snapshot: null,
  errorCode: null,

  // Read one complete snapshot. Every caller receives the same promise while it is pending.
  async load() {
    if (inFlight !== null) {
      if (activeFrames > 0 && get().status === "idle") {
        set({ status: "loading", snapshot: null, errorCode: null });
      }
      return inFlight;
    }

    requestGeneration += 1;
    const generation = requestGeneration;
    set({ status: "loading", snapshot: null, errorCode: null });

    const request = getSettings()
      .then((snapshot) => {
        if (activeFrames > 0 && generation === requestGeneration) {
          set({ status: "ready", snapshot, errorCode: null });
        }
      })
      .catch((rejection: unknown) => {
        if (activeFrames > 0 && generation === requestGeneration) {
          set({ status: "error", snapshot: null, errorCode: readErrorCode(rejection) });
        }
      })
      .finally(() => {
        if (inFlight === request) {
          inFlight = null;
        }

        if (activeFrames === 0 && generation === requestGeneration) {
          set({ status: "idle", snapshot: null, errorCode: null });
        }
      });

    inFlight = request;
    return request;
  },
}));

/** Retain the Settings area and return an idempotent release callback. */
export function retainSettingsArea(): () => void {
  activeFrames += 1;
  let released = false;

  // Release this exact retain once, discarding visible loading state when the last frame leaves.
  return () => {
    if (released) {
      return;
    }

    released = true;
    activeFrames = Math.max(0, activeFrames - 1);
    if (activeFrames === 0 && useSettingsStore.getState().status === "loading") {
      useSettingsStore.setState({ status: "idle", snapshot: null, errorCode: null });
    }
  };
}

/** Reset all module and store state so tests cannot inherit pending work. */
export function resetSettingsStore(): void {
  requestGeneration += 1;
  activeFrames = 0;
  inFlight = null;
  useSettingsStore.setState({ status: "idle", snapshot: null, errorCode: null });
}
