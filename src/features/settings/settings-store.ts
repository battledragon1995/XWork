import { create } from "zustand";
import type {
  AppearanceSettingsDto,
  AppearanceSettingsPatchDto,
  AppSettingsDto,
  NotificationSettingsPatchDto,
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
  notificationSaveStatus: SettingsSaveStatus;
  notificationErrorCode: SettingsErrorCode | null;
  notificationUncertain: boolean;
  dataChangeBlocked: boolean;
  commitNotifications(patch: NotificationSettingsPatchDto): Promise<void>;
  settleBeforeDataChange(): Promise<void>;
  releaseDataChangeBarrier(): void;
  refreshAfterDataChange(): Promise<void>;
  load(): Promise<void>;
  previewAppearance(next: AppearanceSettingsDto): void;
  commitAppearance(patch: AppearanceSettingsPatchDto): Promise<void>;
  restoreAppearance(): Promise<void>;
  discardAppearanceDraft(): void;
}

/** One durable operation sharing the same settings write slot. */
type QueuedMutation =
  | { kind: "update"; patch: AppearanceSettingsPatchDto }
  | { kind: "restore" }
  | { kind: "notifications"; patch: NotificationSettingsPatchDto };

/** Adjacent Appearance edits may share a response; different categories keep their order. */
interface PendingMutation {
  operation: QueuedMutation;
  resolvers: Array<() => void>;
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
let dataBarrier = false;
let activeWrite: Promise<void> | null = null;
let uncertainSettingsWrite = false;
let drainToken = 0;

/** Durable operations waiting for the single write slot. */
let pendingMutations: PendingMutation[] = [];

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

/** Queue category-preserving operations, coalescing only adjacent Appearance edits. */
function enqueueMutation(operation: QueuedMutation): Promise<void> {
  if (dataBarrier || uncertainSettingsWrite) return Promise.resolve();
  const tail = pendingMutations.at(-1);
  const compatible =
    tail && tail.operation.kind !== "notifications" && operation.kind !== "notifications";
  if (compatible) {
    if (operation.kind === "update" && tail.operation.kind === "update") {
      operation = {
        kind: "update",
        patch: coalesceAppearancePatch(tail.operation.patch, operation.patch),
      };
    }
    tail.operation = operation;
  }
  const entry = compatible ? tail : { operation, resolvers: [] };
  if (!compatible) pendingMutations.push(entry);
  if (operation.kind === "notifications") {
    useSettingsStore.setState({ notificationSaveStatus: "saving", notificationErrorCode: null });
  }
  const settled = new Promise<void>(
    /** Resolve when this admitted intent settles or is retired. */ (resolve) => {
      entry.resolvers.push(resolve);
    },
  );
  void drainMutationQueue();
  return settled;
}

/** Retire unsent edits without leaving callers or notification controls pending. */
function discardPendingMutations(): void {
  const policyQueued = pendingMutations.some(
    /** Release only notification work that was never sent. */ (entry) =>
      entry.operation.kind === "notifications",
  );
  for (const entry of pendingMutations) {
    for (const resolve of entry.resolvers) resolve();
  }
  pendingMutations = [];
  if (policyQueued && useSettingsStore.getState().notificationSaveStatus === "saving") {
    useSettingsStore.setState({ notificationSaveStatus: "idle" });
  }
}

/** Accept only snapshots at least as recent as the currently committed revision. */
function currentSnapshot(snapshot: AppSettingsDto): AppSettingsDto {
  const retained = useSettingsStore.getState().snapshot;
  return retained && BigInt(retained.revision) > BigInt(snapshot.revision) ? retained : snapshot;
}

/** Run queued operations one at a time so a slow older write can never win a race. */
async function drainMutationQueue(): Promise<void> {
  if (mutationRunning) {
    return;
  }

  const generation = mutationGeneration;
  const token = ++drainToken;
  mutationRunning = true;
  try {
    while (pendingMutations.length > 0 && generation === mutationGeneration) {
      const entry = pendingMutations.shift();
      if (!entry) break;
      const { operation, resolvers } = entry;

      activeWrite = runMutation(operation);
      await activeWrite;
      activeWrite = null;
      for (const resolve of resolvers) {
        resolve();
      }
      if (uncertainSettingsWrite) discardPendingMutations();
    }
  } finally {
    // A reset already handed the write slot to a fresh queue, so this drain owns nothing.
    if (token === drainToken) {
      mutationRunning = false;
    }
  }
}

/** Execute one operation and reconcile the store with whatever the backend answered. */
async function runMutation(operation: QueuedMutation): Promise<void> {
  const generation = mutationGeneration;
  // Invalidate reads that began before this write was admitted.
  requestGeneration += 1;
  inFlight = null;
  if (operation.kind !== "notifications")
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
        : await updateSettings(
            operation.kind === "notifications"
              ? { notifications: operation.patch }
              : { appearance: operation.patch },
          );

    if (generation !== mutationGeneration) {
      return;
    }

    // A focus read started during this write must not publish its older snapshot.
    requestGeneration += 1;
    inFlight = null;
    if (operation.kind === "notifications") {
      useSettingsStore.setState({
        status: "ready",
        snapshot: currentSnapshot(snapshot),
        errorCode: null,
        notificationSaveStatus: pendingMutations.some(
          /** Keep controls locked for queued policy work. */ (entry) =>
            entry.operation.kind === "notifications",
        )
          ? "saving"
          : "idle",
        notificationErrorCode: null,
        notificationUncertain: false,
      });
      return;
    }
    // A newer Appearance edit may still be queued behind this response.
    const draftIsNewer = pendingMutations.some(
      /** Preserve only a newer Appearance preview. */ (entry) =>
        entry.operation.kind !== "notifications",
    );
    useSettingsStore.setState((state) => ({
      status: "ready",
      snapshot: currentSnapshot(snapshot),
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
    if (code === "unknown") {
      uncertainSettingsWrite = true;
      // A queued policy edit is also blocked when an Appearance response is lost.
      useSettingsStore.setState({
        notificationSaveStatus: "error",
        notificationErrorCode: "unknown",
        notificationUncertain: true,
      });
    }
    if (operation.kind === "notifications") {
      useSettingsStore.setState({
        notificationSaveStatus: "error",
        notificationErrorCode: code,
        notificationUncertain: code === "unknown",
      });
      return;
    }
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
  notificationSaveStatus: "idle",
  notificationErrorCode: null,
  notificationUncertain: false,
  dataChangeBlocked: false,

  /** Claim synchronously, discard unsent edits, then await the actual write promise. */
  async settleBeforeDataChange() {
    dataBarrier = true;
    discardPendingMutations();
    set({ appearanceDraft: null, dataChangeBlocked: true });
    await activeWrite;
    if (uncertainSettingsWrite) throw new Error("Uncertain settings write");
  },
  /** Release only the maintenance write gate. */
  releaseDataChangeBarrier() {
    dataBarrier = false;
    set({ dataChangeBlocked: false });
  },
  /** Retire stale reads/drafts without discarding the application's permanent retain. */
  async refreshAfterDataChange() {
    const generation = ++requestGeneration;
    mutationGeneration += 1;
    discardPendingMutations();
    inFlight = null;
    set({
      appearanceDraft: null,
      lastFailedPatch: null,
      saveStatus: "idle",
      saveError: null,
      saveErrorCode: null,
      status: "loading",
      notificationSaveStatus: "idle",
      notificationErrorCode: null,
    });
    try {
      const snapshot = await getSettings();
      if (generation === requestGeneration) {
        uncertainSettingsWrite = false;
        set({ snapshot, status: "ready", errorCode: null, notificationUncertain: false });
      }
    } catch (error) {
      if (generation === requestGeneration)
        set({ status: "error", snapshot: null, errorCode: readErrorCode(error) });
      throw error;
    }
  },
  // Read one complete snapshot. Every caller receives the same promise while it is pending.
  async load() {
    // A reconciliation must observe the outcome of the actual in-flight mutation.
    while (activeWrite) await activeWrite;
    if (inFlight !== null) {
      if (activeFrames > 0 && get().status === "idle") {
        set({ status: "loading", snapshot: null, errorCode: null });
      }
      return inFlight;
    }

    requestGeneration += 1;
    const generation = requestGeneration;
    set({ status: "loading", errorCode: null });

    const request = getSettings()
      .then((snapshot) => {
        if (activeFrames > 0 && generation === requestGeneration) {
          uncertainSettingsWrite = false;
          set({
            status: "ready",
            snapshot: currentSnapshot(snapshot),
            errorCode: null,
            notificationSaveStatus: "idle",
            notificationErrorCode: null,
            notificationUncertain: false,
          });
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
    if (dataBarrier) return;
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
    if (!hasAppearanceField(patch)) {
      return;
    }

    return enqueueMutation({ kind: "update", patch });
  },

  /** Persist one policy patch without previewing uncommitted values or blindly retrying. */
  async commitNotifications(patch) {
    if (
      get().notificationSaveStatus === "saving" ||
      get().notificationSaveStatus === "error" ||
      get().status !== "ready"
    )
      return;
    if (
      !Object.values(patch).some(
        /** Reject empty policy patches locally. */ (value) => value !== undefined,
      )
    )
      return;
    return enqueueMutation({ kind: "notifications", patch });
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
  pendingMutations = [];
  bootstrapped = false;
  dataBarrier = false;
  activeWrite = null;
  uncertainSettingsWrite = false;
  drainToken += 1;
  useSettingsStore.setState({
    status: "idle",
    snapshot: null,
    errorCode: null,
    appearanceDraft: null,
    saveStatus: "idle",
    saveErrorCode: null,
    saveError: null,
    lastFailedPatch: null,
    notificationSaveStatus: "idle",
    notificationErrorCode: null,
    notificationUncertain: false,
    dataChangeBlocked: false,
  });
}
