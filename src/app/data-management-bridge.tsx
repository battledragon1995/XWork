import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { DataChangeKindDto } from "@/bindings/data-management";
import { Button } from "@/components/ui/button";
import { useFileDataBoundary } from "@/features/files";
import { useProjectsStore } from "@/features/projects/projects-store";
import { useSessionsStore } from "@/features/sessions/sessions-store";
import { useCliProfilesStore } from "@/features/settings/cli-profiles-store";
import { dataErrorCopy } from "@/features/settings/data-error-copy";
import {
  DataManagementProvider,
  useDataManagement,
} from "@/features/settings/data-management-provider";
import { DataOperationDialog } from "@/features/settings/data-operation-dialog";
import { useKeyboardShortcuts } from "@/features/settings/keyboard-shortcuts-provider";
import { useSettingsStore } from "@/features/settings/settings-store";
import { useTerminalDataBoundary } from "@/features/terminal";
import { onDataChanged } from "@/lib/ipc/data-management";
import { useShellStore } from "./shell-store";

/** Compose public owner maintenance APIs below the router and shortcut provider. */
export function DataManagementHost(props: { children: React.ReactNode }) {
  const shortcuts = useKeyboardShortcuts();
  const terminal = useTerminalDataBoundary();
  const fileData = useFileDataBoundary();
  const navigate = useNavigate();
  const failedReads = useRef<Array<() => Promise<void>>>([]);
  /** Try every owner even if an earlier read fails; retain only failed reads for Retry. */
  async function readAll(reads: Array<() => Promise<void>>) {
    const results = await Promise.allSettled(
      reads.map(
        /** Convert synchronous failures into rejected reads. */ (read) =>
          Promise.resolve().then(read),
      ),
    );
    failedReads.current = reads.filter(
      /** Retain exactly the failing query callbacks. */ (_, index) =>
        results[index]?.status === "rejected",
    );
    if (failedReads.current.length) throw new Error("Owner refresh failed");
  }
  /** Read settings and apply chrome projection without writing imported values back. */
  async function settingsRead() {
    await useSettingsStore.getState().refreshAfterDataChange();
    const sidebar = useSettingsStore.getState().snapshot?.sidebar;
    if (sidebar) {
      useShellStore.getState().setSidebarWidthPx(sidebar.widthPx);
      useShellStore.setState({ isSidebarCollapsed: sidebar.collapsed, isSidebarResizing: false });
    }
  }
  /** Claim all producer barriers in the same turn and release all of them on failure. */
  async function beforeConfirm() {
    const owners = [useSettingsStore.getState(), useCliProfilesStore.getState(), shortcuts];
    const attempts = owners.map(
      /** Claim each barrier synchronously. */ (owner) => owner.settleBeforeDataChange(),
    );
    const results = await Promise.allSettled(attempts);
    let released = false;
    /** Release the exact owner instances once, after confirmation and reconciliation. */
    const release = () => {
      if (!released) {
        released = true;
        for (const owner of owners) owner.releaseDataChangeBarrier();
      }
    };
    if (
      results.some(
        /** Detect uncertain producer outcomes. */ (result) => result.status === "rejected",
      )
    ) {
      release();
      throw new Error("Pending write uncertain");
    }
    return release;
  }
  /** Reset clears metadata immediately; import preserves active terminal identity. */
  async function onCommitted(kind: DataChangeKindDto) {
    const reset = kind === "app_reset";
    if (reset) {
      terminal.clearAfterReset();
      // Handles are dropped before navigation so no query for a deleted handle survives Home.
      fileData.clearAfterReset();
    }
    // Invoke these APIs before navigation so Home cannot render deleted rows even on query failure.
    const projects = useProjectsStore.getState().refreshAfterDataChange(reset);
    const sessions = useSessionsStore.getState().refreshAfterDataChange(reset);
    if (reset) void navigate("/", { replace: true });
    const reads = [
      settingsRead,
      /** Refresh the existing CLI owner. */ () =>
        useCliProfilesStore.getState().refreshAfterDataChange(),
      shortcuts.refreshAfterDataChange,
      /** Observe the already-started project read. */ () => projects,
      /** Observe the already-started runtime read. */ () => sessions,
    ];
    try {
      await readAll(reads);
    } finally {
      // Failed initial reads must be retried with fresh queries, not with rejected promises.
      failedReads.current = failedReads.current.map(
        /** Replace only the two initial promise observers. */ (read) =>
          read === reads[3]
            ? () => useProjectsStore.getState().refreshAfterDataChange(false)
            : read === reads[4]
              ? () => useSessionsStore.getState().refreshAfterDataChange(false)
              : read,
      );
    }
  }
  /** Query surviving runtime after an uncertain or partially stopped reset. */
  async function onResetUncertain() {
    await readAll([
      /** Preserve metadata until commit is known. */ () =>
        useSessionsStore.getState().refreshAfterDataChange(false),
      terminal.reconcileAfterResetFailure,
      /** An uncertain reset only re-reads retained handles; nothing is deleted here. */
      async () => fileData.reconcileAfterResetFailure(),
    ]);
  }
  /** Retry only failed reads, or reconcile all owners for an unknown command outcome. */
  async function refreshViews() {
    await readAll(
      failedReads.current.length
        ? failedReads.current
        : [
            settingsRead,
            /** Refresh CLI state after an uncertain producer command. */ () =>
              useCliProfilesStore.getState().refreshAfterDataChange(),
            shortcuts.refreshAfterDataChange,
            /** Query projects without replaying import/reset. */ () =>
              useProjectsStore.getState().refreshAfterDataChange(false),
            /** Query sessions without clearing unconfirmed state. */ () =>
              useSessionsStore.getState().refreshAfterDataChange(false),
            terminal.reconcileAfterResetFailure,
            /** Re-read retained handles for an unknown command outcome. */
            async () => fileData.reconcileAfterResetFailure(),
          ],
    );
  }
  return (
    <DataManagementProvider
      beforeConfirm={beforeConfirm}
      onCommitted={onCommitted}
      onResetUncertain={onResetUncertain}
      refreshViews={refreshViews}
    >
      {props.children}
    </DataManagementProvider>
  );
}

/** Keep aggregate registration, preview dialogs and result feedback alive outside Data routes. */
export function DataManagementBridge() {
  const data = useDataManagement();
  const [retry, setRetry] = useState(0);
  const resetFocus = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly starts a new native listener lifetime.
  useEffect(
    /** Dispose even a registration that resolves after the host unmounts. */ () => {
      let active = true;
      let unlisten: (() => void) | null = null;
      data.setListenerStatus("registering");
      void onDataChanged(
        /** Feed native events into the same commit pipeline as command results. */ (event) => {
          if (active) void data.acceptCommitted(event.kind);
        },
      )
        .then(
          /** Dispose late listeners immediately. */ (remove) => {
            if (active) {
              unlisten = remove;
              data.setListenerStatus("ready");
            } else remove();
          },
        )
        .catch(
          /** Expose command-result fallback after listener failure. */ () => {
            if (active) data.setListenerStatus("error");
          },
        );
      return () => {
        active = false;
        unlisten?.();
      };
    },
    [data.acceptCommitted, data.setListenerStatus, retry],
  );
  useEffect(
    /** Hidden preview requests expire locally, but apply continues in the host. */ () => {
      const visibility = /** Retire only unconfirmed work. */ () => {
        if (document.hidden) void data.retirePreview();
      };
      document.addEventListener("visibilitychange", visibility);
      return () => document.removeEventListener("visibilitychange", visibility);
    },
    [data.retirePreview],
  );
  useEffect(
    /** Focus the surviving Home heading only after modal release and native visibility. */ () => {
      const focus = /** Consume one reset focus request when the main window is visible. */ () => {
        if (!document.hidden && !data.busy && data.resetEpoch > resetFocus.current) {
          const heading = document.querySelector("h1");
          if (heading instanceof HTMLElement) {
            heading.tabIndex = -1;
            heading.focus();
            resetFocus.current = data.resetEpoch;
          }
        }
      };
      focus();
      document.addEventListener("visibilitychange", focus);
      return () => document.removeEventListener("visibilitychange", focus);
    },
    [data.resetEpoch, data.busy],
  );
  const cleanupPending =
    data.result &&
    "credentialCleanupPending" in data.result &&
    data.result.credentialCleanupPending > 0;
  return (
    <>
      <div className="shrink-0 space-y-1 px-8 text-sm" aria-live="polite">
        {data.listenerStatus === "error" && (
          <p role="alert">
            Live data updates are unavailable. You can continue using command results.{" "}
            <Button
              variant="outline"
              onClick={
                /** Retry registration without replaying commands. */ () => setRetry(retry + 1)
              }
            >
              Retry live updates
            </Button>
          </p>
        )}
        {data.phase === "preparing" && (
          <p role="status" className="flex items-center gap-2">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {data.operation === "export"
              ? "Choosing backup…"
              : data.operation === "import"
                ? "Preparing import…"
                : "Preparing reset…"}
          </p>
        )}
        {data.message && <p role="status">{data.message}</p>}
        {data.result && "applied" in data.result && (
          <p>
            Applied: {data.result.applied.inserts} inserts, {data.result.applied.updates} updates,{" "}
            {data.result.applied.unchanged} unchanged, {data.result.applied.removals} removals.
          </p>
        )}
        {data.result && "kind" in data.result && data.result.kind === "exported" && (
          <p>
            Exported schema {data.result.schemaVersion}: {data.result.counts.projects} projects,{" "}
            {data.result.counts.customCliProfiles} custom CLI profiles,{" "}
            {data.result.counts.secretReferences} secret references,{" "}
            {data.result.counts.keyboardShortcutOverrides} shortcut overrides.
          </p>
        )}
        {data.result && "projectsRemoved" in data.result && (
          <p>
            Removed: {data.result.projectsRemoved} projects, {data.result.customCliProfilesRemoved}{" "}
            custom CLI profiles, {data.result.keyboardShortcutOverridesRemoved} shortcut overrides.
            Sessions stopped: {data.result.sessionsStopped}.
          </p>
        )}
        {cleanupPending && (
          <p role="status">
            Some saved credentials are still being removed. XWork will retry cleanup.
          </p>
        )}
        {data.failure && data.phase !== "preview" && (
          <p role="alert">{dataErrorCopy(data.failure)}</p>
        )}
        {data.refreshFailures.map(
          /** Render safe aggregate read failures. */ (failure) => (
            <p role="alert" key={failure}>
              {failure}
            </p>
          ),
        )}
        {(data.refreshFailures.length > 0 || data.phase === "uncertain" || data.failure) && (
          <Button
            variant="outline"
            disabled={data.busy}
            onClick={/** Retry reads only. */ () => void data.refreshViews()}
          >
            Refresh views
          </Button>
        )}
        {data.phase === "uncertain" && (
          <Button
            variant="outline"
            disabled={data.busy || !data.canAcknowledgeUncertain}
            onClick={data.acknowledgeUncertain}
          >
            Acknowledge uncertainty
          </Button>
        )}
      </div>
      <DataOperationDialog />
    </>
  );
}
