import type {
  BackupExportOutcomeDto,
  BackupImportPreviewDto,
  BackupImportResultDto,
  DataChangeKindDto,
  DataManagementError,
  ResetImpactDto,
  ResetResultDto,
} from "@/bindings/data-management";
import * as ipc from "@/lib/ipc/data-management";
import type { IpcCallError } from "@/lib/ipc/ipc-error";
import { dataFailure } from "./data-error-copy";

export interface DataCallbacks {
  beforeConfirm(): Promise<() => void>;
  onCommitted(kind: DataChangeKindDto): Promise<void>;
  onResetUncertain(): Promise<void>;
  /** Retry only owner reads that failed in the last reconciliation. */
  refreshViews(): Promise<void>;
}
export interface DataManagementState {
  phase: "idle" | "preparing" | "preview" | "applying" | "cancelling" | "uncertain";
  operation: "export" | "import" | "reset" | null;
  preview: BackupImportPreviewDto | ResetImpactDto | null;
  confirmation: string;
  result: BackupExportOutcomeDto | BackupImportResultDto | ResetResultDto | null;
  failure: IpcCallError<DataManagementError> | null;
  message: string | null;
  generation: number;
  busy: boolean;
  invalidationEpoch: number;
  resetEpoch: number;
  refreshFailures: readonly string[];
  canAcknowledgeUncertain: boolean;
  listenerStatus: "registering" | "ready" | "error";
  prepare(operation: "export" | "import" | "reset"): Promise<void>;
  setConfirmation(value: string): void;
  confirm(): Promise<void>;
  cancel(): Promise<void>;
  retirePreview(): Promise<void>;
  acceptCommitted(kind: DataChangeKindDto): Promise<void>;
  refreshViews(): Promise<void>;
  acknowledgeUncertain(): void;
  setListenerStatus(status: DataManagementState["listenerStatus"]): void;
  /** Read current epochs synchronously from async composition callbacks. */
  getCurrent(): DataManagementState;
}
/** Create one shell-lifetime operation owner with explicit reconciliation dependencies. */
export function createDataManagementState(callbacks: DataCallbacks) {
  const listeners = new Set<() => void>();
  let disposed = false;
  let flight: Promise<void> | null = null;
  let activeConfirm: { kind: DataChangeKindDto; committed: Promise<void> | null } | null = null;
  let reconciliation = Promise.resolve();
  let reconciliations = 0;
  let uncertaintyRefreshed = false;
  let state: DataManagementState = {
    phase: "idle",
    operation: null,
    preview: null,
    confirmation: "",
    result: null,
    failure: null,
    message: null,
    generation: 0,
    busy: false,
    invalidationEpoch: 0,
    resetEpoch: 0,
    refreshFailures: [],
    canAcknowledgeUncertain: false,
    listenerStatus: "registering",
    prepare,
    confirm,
    cancel: retirePreview,
    retirePreview,
    acceptCommitted,
    refreshViews,
    /** Keep the typed literal in transient memory only. */
    setConfirmation(value) {
      if (state.phase === "preview") publish({ confirmation: value });
    },
    /** Allow a new explicit operation only after read reconciliation and acknowledgement. */
    acknowledgeUncertain() {
      if (state.phase === "uncertain" && uncertaintyRefreshed && !flight)
        publish({ phase: "idle", failure: null, message: null });
    },
    /** Publish listener availability; command-result fallback remains explicit in the host. */
    setListenerStatus(listenerStatus) {
      publish({ listenerStatus });
    },
    /** Access the newest generation without waiting for a React render. */
    getCurrent: () => state,
  };
  /** Publish a stable snapshot with the actual operation lock reflected synchronously. */
  function publish(patch: Partial<DataManagementState>) {
    state = { ...state, ...patch };
    state.busy =
      state.phase === "preparing" ||
      state.phase === "applying" ||
      state.phase === "cancelling" ||
      reconciliations > 0;
    if (!disposed) for (const listener of listeners) listener();
  }
  /** Retire one exact pending ID; never guess cancellation of a native picker. */
  async function cancelRequest(requestId: number) {
    try {
      await ipc.cancelDataOperation(requestId);
    } catch (error) {
      const code = dataFailure(error).payload?.code;
      if (code !== "stale_request" && code !== "no_pending_operation")
        publish({ message: "Could not confirm cancellation." });
    }
  }
  /** Claim the operation synchronously before any native work can yield. */
  function prepare(operation: "export" | "import" | "reset"): Promise<void> {
    if (
      disposed ||
      flight ||
      state.busy ||
      state.phase !== "idle" ||
      state.listenerStatus === "registering"
    )
      return Promise.resolve();
    const generation = state.generation + 1;
    publish({
      phase: "preparing",
      operation,
      generation,
      result: null,
      failure: null,
      message: null,
      confirmation: "",
    });
    const work = Promise.resolve().then(async () => {
      try {
        if (operation === "export") {
          const result = await ipc.exportBackup();
          if (!disposed && state.generation === generation)
            publish({
              result,
              message: result.kind === "exported" ? `Backup exported: ${result.fileName}` : null,
            });
        } else {
          const result =
            operation === "import"
              ? await ipc.prepareImportBackup()
              : await ipc.prepareResetXwork();
          const preview =
            "kind" in result ? (result.kind === "ready" ? result.preview : null) : result;
          if (preview && (disposed || state.generation !== generation))
            await cancelRequest(preview.requestId);
          else if (preview) publish({ preview, phase: "preview" });
        }
      } catch (error) {
        if (!disposed && generation === state.generation) publish({ failure: dataFailure(error) });
      } finally {
        flight = null;
        if (state.phase === "preparing" || state.phase === "cancelling") publish({ phase: "idle" });
      }
    });
    flight = work;
    return work;
  }
  /** Close a preview and cancel late ready responses while preserving apply lifetime. */
  async function retirePreview(): Promise<void> {
    if (state.phase === "applying") return;
    if (state.phase === "cancelling") {
      await flight;
      return;
    }
    if (state.phase !== "preview" && state.phase !== "preparing") return;
    const preview = state.preview;
    publish({
      generation: state.generation + 1,
      phase: "cancelling",
      preview: null,
      confirmation: "",
    });
    if (flight) {
      await flight;
      return;
    }
    const work = preview ? cancelRequest(preview.requestId) : Promise.resolve();
    flight = work;
    await work;
    flight = null;
    publish({ phase: "idle" });
  }
  /** Serialize owner refreshes while invalidating old navigation immediately. */
  function reconcile(kind: DataChangeKindDto): Promise<void> {
    reconciliations += 1;
    publish({
      invalidationEpoch: state.invalidationEpoch + 1,
      resetEpoch: state.resetEpoch + (kind === "app_reset" ? 1 : 0),
      preview: null,
      confirmation: "",
      failure: null,
      message: kind === "app_reset" ? "XWork has been reset." : "Backup imported.",
    });
    const work = reconciliation.then(async () => {
      try {
        await callbacks.onCommitted(kind);
        publish({ refreshFailures: [] });
      } catch {
        publish({
          refreshFailures: ["Changes were saved, but some views could not be refreshed."],
        });
      } finally {
        reconciliations -= 1;
        publish({});
      }
    });
    reconciliation = work;
    return work;
  }
  /** Coalesce only within the same local confirmation lifetime, never by time or kind forever. */
  function acceptCommitted(kind: DataChangeKindDto): Promise<void> {
    if (activeConfirm?.kind === kind) {
      activeConfirm.committed ??= reconcile(kind);
      return activeConfirm.committed;
    }
    // No revision exists on external events; retire any reviewed or still-preparing request.
    if (state.phase === "preview" || state.phase === "preparing") void retirePreview();
    if (state.phase === "uncertain") publish({ phase: "idle" });
    return reconcile(kind);
  }
  /** Send exactly one explicit confirmation and retain barriers through reconciliation. */
  function confirm(): Promise<void> {
    if (
      disposed ||
      flight ||
      state.busy ||
      state.phase !== "preview" ||
      !state.preview ||
      state.listenerStatus === "registering"
    )
      return Promise.resolve();
    if (state.operation === "reset" && state.confirmation.trim() !== "RESET")
      return Promise.resolve();
    const preview = state.preview;
    const reset = state.operation === "reset";
    const confirmation = state.confirmation;
    const attempt = {
      kind: reset ? ("app_reset" as const) : ("backup_imported" as const),
      committed: null as Promise<void> | null,
    };
    activeConfirm = attempt;
    publish({ phase: "applying", failure: null, invalidationEpoch: state.invalidationEpoch + 1 });
    const work = Promise.resolve().then(async () => {
      let release: (() => void) | null = null;
      let sent = false;
      let nextPhase: DataManagementState["phase"] = "idle";
      try {
        release = await callbacks.beforeConfirm();
        sent = true;
        const result = reset
          ? await ipc.confirmResetXwork(preview.requestId, confirmation)
          : await ipc.confirmImportBackup(preview.requestId);
        publish({ result });
        await acceptCommitted(attempt.kind);
      } catch (error) {
        if (attempt.committed) await attempt.committed;
        else {
          const failure = dataFailure(error);
          const payload = failure.payload;
          publish({ failure });
          if (!sent) {
            nextPhase = "preview";
            publish({
              message:
                "Could not settle pending settings changes. Refresh views before confirming again.",
            });
          } else if (payload?.code === "import_preview_changed") {
            nextPhase = "preview";
            publish({ preview: payload.preview, confirmation: "" });
          } else if (payload?.code === "invalid_reset_confirmation") nextPhase = "preview";
          else {
            publish({ preview: null, confirmation: "" });
            if (!payload) {
              nextPhase = "uncertain";
              uncertaintyRefreshed = false;
              publish({ canAcknowledgeUncertain: false });
            }
            if (reset) {
              try {
                await callbacks.onResetUncertain();
              } catch {
                publish({ refreshFailures: ["Some views could not be refreshed."] });
              }
              if (payload?.code === "persistence_failed")
                publish({
                  message:
                    "Some sessions may have stopped. Refresh views before preparing another reset.",
                });
            }
          }
        }
      } finally {
        release?.();
        activeConfirm = null;
        flight = null;
        publish({ phase: nextPhase });
      }
    });
    flight = work;
    return work;
  }
  /** Retry reads only and keep uncertainty visible until explicitly acknowledged. */
  async function refreshViews() {
    if (flight || state.busy) return;
    reconciliations += 1;
    publish({});
    try {
      await callbacks.refreshViews();
      uncertaintyRefreshed = true;
      publish({ canAcknowledgeUncertain: true });
      publish({ refreshFailures: [] });
    } catch {
      publish({ refreshFailures: ["Some views could not be refreshed."] });
    } finally {
      reconciliations -= 1;
      publish({});
    }
  }
  return {
    /** Read one stable external-store snapshot. */
    getSnapshot: () => state,
    /** Retain one React subscription. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return /** Remove only this subscription. */ () => {
        listeners.delete(listener);
      };
    },
    /** StrictMode can reattach the same operation owner without abandoning sent work. */
    attach() {
      disposed = false;
    },
    /** Retire unconfirmed requests; actual apply work retains its lock and callbacks. */
    dispose() {
      disposed = true;
      void retirePreview();
      listeners.clear();
    },
  };
}
