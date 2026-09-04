import { create } from "zustand";
import type {
  AppearanceSettingsDto,
  AppearanceSettingsPatchDto,
  AppSettingsDto,
  SettingsError,
} from "@/bindings/settings";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getSettings, restoreAppearanceDefaults, updateSettings } from "@/lib/ipc/settings";

/** Lifecycle of the retained settings snapshot. */
export type SettingsStatus = "idle" | "loading" | "ready" | "error";

/** Lifecycle of the most recent Appearance write. */
export type SettingsSaveStatus = "idle" | "saving" | "error";

/** Known backend code, or the marker for a malformed/transport rejection. */
export type SettingsErrorCode = SettingsError["code"] | "unknown";

/** Settings state shared by every child route in the Settings frame. */
export interface SettingsState {
  status: SettingsStatus;
  snapshot: AppSettingsDto | null;
  errorCode: SettingsErrorCode | null;
  appearanceDraft: AppearanceSettingsDto | null;
  saveStatus: SettingsSaveStatus;
  saveErrorCode: SettingsErrorCode | null;
  saveError: SettingsError | null;
  lastFailedPatch: AppearanceSettingsPatchDto | null;
  load(): Promise<void>;
  previewAppearance(next: AppearanceSettingsDto): void;
  commitAppearance(patch: AppearanceSettingsPatchDto): Promise<void>;
  restoreAppearance(): Promise<void>;
  discardAppearanceDraft(): void;
}

/** One queued durable Appearance operation waiting for the single write slot. */
type QueuedMutation = { kind: "update"; patch: AppearanceSettingsPatchDto } | { kind: "restore" };

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

/** Failures whose value the user can still correct, so the draft stays on screen. */
const RETAIN_DRAFT_CODES = new Set<SettingsErrorCode>([
  "invalid_color",
  "contrast_too_low",
  "persistence_failed",
  "unavailable",
]);

/** Colour fields a built-in preset would contradict inside one coalesced patch. */
const PRESET_CONFLICT_FIELDS = ["interfaceColors", "terminalPalette"] as const;

/** Number of mounted Settings frames currently allowed to receive a completion. */
let activeFrames = 0;

/** Generation that prevents an obsolete read from replacing newer state. */
let requestGeneration = 0;

/** Shared request used to collapse repeated loads and development remounts. */
let inFlight: Promise<void> | null = null;

/** Generation that prevents a mutation started before a reset from writing new state. */
let mutationGeneration = 0;

/** True while exactly one durable Appearance write is crossing the command boundary. */
let mutationRunning = false;

/** The single coalesced operation waiting for the write slot. */
let pendingMutation: QueuedMutation | null = null;

/** Callers waiting for the pending operation to be processed. */
let pendingResolvers: Array<() => void> = [];

/** True once the application has taken its one startup read of the settings snapshot. */
let bootstrapped = false;

/** Extract the generated settings error, or `null` for a malformed rejection. */
function readSettingsError(rejection: unknown): SettingsError | null {
  if (!(rejection instanceof IpcCallError) || rejection.payload === null) {
    return null;
  }

  const payload = rejection.payload as SettingsError;
  return SETTINGS_ERROR_CODES.has(payload.code) ? payload : null;
}

/** Extract only a code that belongs to the generated settings error union. */
function readErrorCode(rejection: unknown): SettingsErrorCode {
  return readSettingsError(rejection)?.code ?? "unknown";
}

/** Report whether one Appearance patch carries at least one field the backend accepts. */
function hasAppearanceField(patch: AppearanceSettingsPatchDto): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}

/**
 * Merge a newly requested patch onto the queued one. Fields simply take their newest value,
 * except that BE-008 forbids sending a built-in preset together with custom colours: the
 * newer intent wins and the older conflicting fields are dropped from the queue.
 */
function coalesceAppearancePatch(
  queued: AppearanceSettingsPatchDto | null,
  next: AppearanceSettingsPatchDto,
): AppearanceSettingsPatchDto {
  const merged: AppearanceSettingsPatchDto = { ...(queued ?? {}), ...next };

  if (next.themePreset !== undefined && next.themePreset !== "custom") {
    for (const field of PRESET_CONFLICT_FIELDS) {
      delete merged[field];
    }
  }

  if (next.interfaceColors !== undefined || next.terminalPalette !== undefined) {
    if (merged.themePreset !== undefined && merged.themePreset !== "custom") {
      delete merged.themePreset;
    }
  }

  return merged;
}

/** Queue one operation, replacing whatever compatible work was still waiting. */
function enqueueMutation(operation: QueuedMutation): Promise<void> {
  pendingMutation = operation;
  const settled = new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
  });
  void drainMutationQueue();
  return settled;
}

/** Run queued operations one at a time so a slow older write can never win a race. */
async function drainMutationQueue(): Promise<void> {
  if (mutationRunning) {
    return;
  }

  const generation = mutationGeneration;
  mutationRunning = true;
  try {
    while (pendingMutation !== null && generation === mutationGeneration) {
      const operation = pendingMutation;
      const resolvers = pendingResolvers;
      pendingMutation = null;
      pendingResolvers = [];

      await runMutation(operation);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  } finally {
    // A reset already handed the write slot to a fresh queue, so this drain owns nothing.
    if (generation === mutationGeneration) {
      mutationRunning = false;
    }
  }
}

/** Execute one operation and reconcile the store with whatever the backend answered. */
async function runMutation(operation: QueuedMutation): Promise<void> {
  const generation = mutationGeneration;
  useSettingsStore.setState({
    saveStatus: "saving",
    saveErrorCode: null,
    saveError: null,
    lastFailedPatch: null,
  });

  try {
    const snapshot =
      operation.kind === "restore"
        ? await restoreAppearanceDefaults()
        : await updateSettings({ appearance: operation.patch });

    if (generation !== mutationGeneration) {
      return;
    }

    // A newer edit may already be queued behind this response, so its preview is kept.
    const draftIsNewer = pendingMutation !== null;
    useSettingsStore.setState((state) => ({
      status: "ready",
      snapshot,
      errorCode: null,
      appearanceDraft: draftIsNewer ? state.appearanceDraft : null,
      saveStatus: "idle",
      saveErrorCode: null,
      saveError: null,
      lastFailedPatch: null,
    }));
  } catch (rejection: unknown) {
    if (generation !== mutationGeneration) {
      return;
    }

    const error = readSettingsError(rejection);
    const code = error?.code ?? "unknown";
    const retainDraft = RETAIN_DRAFT_CODES.has(code);
    useSettingsStore.setState((state) => ({
      saveStatus: "error",
      saveErrorCode: code,
      saveError: error,
      lastFailedPatch: operation.kind === "update" ? operation.patch : null,
      appearanceDraft: retainDraft ? state.appearanceDraft : null,
    }));
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  status: "idle",
  snapshot: null,
  errorCode: null,
  appearanceDraft: null,
  saveStatus: "idle",
  saveErrorCode: null,
  saveError: null,
  lastFailedPatch: null,

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

  // Show one drafted Appearance value immediately, without touching the backend.
  previewAppearance(next) {
    // A new edit replaces the previous failure, so a stale alert cannot outlive its value.
    const clearFailure = get().saveStatus === "error";
    set({
      appearanceDraft: next,
      ...(clearFailure
        ? { saveStatus: "idle" as const, saveErrorCode: null, saveError: null }
        : {}),
    });
  },

  // Persist one Appearance patch, coalescing it with whatever is already waiting.
  async commitAppearance(patch) {
    const queued = pendingMutation?.kind === "update" ? pendingMutation.patch : null;
    const merged = coalesceAppearancePatch(queued, patch);
    if (!hasAppearanceField(merged)) {
      return;
    }

    return enqueueMutation({ kind: "update", patch: merged });
  },

  // Reset every Appearance field through the backend and adopt the returned snapshot.
  async restoreAppearance() {
    return enqueueMutation({ kind: "restore" });
  },

  // Drop an unsaveable preview so the window returns to the last committed theme.
  discardAppearanceDraft() {
    set({ appearanceDraft: null });
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

/**
 * Take the one startup read that lets the window paint the stored theme. The retain is
 * deliberately never released: the theme belongs to the whole application, not to the
 * Settings frame, so a late response must always reach the store.
 */
export function bootstrapAppSettings(): void {
  if (bootstrapped) {
    return;
  }

  bootstrapped = true;
  retainSettingsArea();
  if (useSettingsStore.getState().status === "idle") {
    void useSettingsStore.getState().load();
  }
}

/** Reset all module and store state so tests cannot inherit pending work. */
export function resetSettingsStore(): void {
  requestGeneration += 1;
  mutationGeneration += 1;
  activeFrames = 0;
  inFlight = null;
  mutationRunning = false;
  pendingMutation = null;
  pendingResolvers = [];
  bootstrapped = false;
  useSettingsStore.setState({
    status: "idle",
    snapshot: null,
    errorCode: null,
    appearanceDraft: null,
    saveStatus: "idle",
    saveErrorCode: null,
    saveError: null,
    lastFailedPatch: null,
  });
}
