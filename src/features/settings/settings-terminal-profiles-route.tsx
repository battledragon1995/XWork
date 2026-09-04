import { useEffect, useId, useRef, useState } from "react";
import type { CliProfileInputDto, CliShellDto } from "@/bindings/terminal/cli-profiles";
import { Button } from "@/components/ui/button";
import { CliProfileEditor } from "./cli-profile-editor";
import { CliProfileTable } from "./cli-profile-table";
import { useCliProfilesStore } from "./cli-profiles-store";
import { DeleteCliProfileDialog } from "./delete-cli-profile-dialog";
import { SettingRow, SettingsSection } from "./settings-section";

/** Catalog id that stands for the resolved system shell rather than a concrete one. */
const SYSTEM_SHELL_ID = "system";

/** Maximum number of custom profiles BE-006 stores, mirrored here only to disable New. */
const MAX_CUSTOM_PROFILES = 100;

/** Shared select styling, kept local because FE-013 adds no shared form primitive. */
const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

/** Report whether the catalog still offers something the user could actually launch. */
function hasUsableShell(shells: readonly CliShellDto[]): boolean {
  return shells.some((shell) => shell.isAvailable);
}

/** Render the labelled default-shell control plus its effective-shell and failure lines. */
function DefaultShellField(props: {
  shells: readonly CliShellDto[];
  defaultShellId: string;
  effectiveDefaultShellId: string;
  value: string;
  disabled: boolean;
  errorMessage: string | null;
  onChange(shellId: string): void;
}) {
  const { shells, defaultShellId, effectiveDefaultShellId, value, disabled, errorMessage } = props;
  const errorId = useId();
  const systemShell = shells.find((shell) => shell.id === SYSTEM_SHELL_ID);
  const concreteShells = shells.filter((shell) => shell.id !== SYSTEM_SHELL_ID);
  // A persisted shell the catalog no longer lists is shown as it is. Silently switching the
  // stored default to something else would be a write the user never asked for.
  const persistedIsMissing = !shells.some((shell) => shell.id === defaultShellId);
  const effectiveShell = shells.find((shell) => shell.id === effectiveDefaultShellId);
  const noShellAvailable = !hasUsableShell(shells);

  return (
    <div className="min-w-0">
      <select
        aria-describedby={errorMessage === null ? undefined : errorId}
        aria-invalid={errorMessage === null ? undefined : true}
        aria-label="Default shell"
        className={SELECT_CLASS}
        disabled={disabled || noShellAvailable}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        value={value}
      >
        {persistedIsMissing && (
          <option value={defaultShellId}>Unavailable: {defaultShellId}</option>
        )}
        {systemShell !== undefined && <option value={SYSTEM_SHELL_ID}>System default</option>}
        {concreteShells.map((shell) => (
          <option disabled={!shell.isAvailable} key={shell.id} value={shell.id}>
            {shell.displayName}
          </option>
        ))}
      </select>
      {defaultShellId === SYSTEM_SHELL_ID && effectiveShell !== undefined && (
        <p className="mt-1 text-right text-[12px] text-muted">
          Resolves to {effectiveShell.displayName} ({effectiveShell.command}).
        </p>
      )}
      {noShellAvailable && (
        <p className="mt-1 text-right text-[12px] text-muted">
          No available shell was found. Install a supported shell, then refresh.
        </p>
      )}
      {errorMessage !== null && (
        <p className="mt-1 text-right text-[12px] text-error" id={errorId} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

/**
 * Render the Terminal & CLI Profiles section. The route owns only the store subscription, the
 * transient shell selection, and which profile a later modal is pointed at; every persisted
 * fact on screen comes from the snapshot BE-006 committed.
 */
export function SettingsTerminalProfilesRoute() {
  const status = useCliProfilesStore((state) => state.status);
  const snapshot = useCliProfilesStore((state) => state.snapshot);
  const failure = useCliProfilesStore((state) => state.failure);
  const listenerFailed = useCliProfilesStore((state) => state.listenerFailed);
  const mutation = useCliProfilesStore((state) => state.mutation);
  const checkingProfileIds = useCliProfilesStore((state) => state.checkingProfileIds);
  const refresh = useCliProfilesStore((state) => state.refresh);
  const setDefaultShell = useCliProfilesStore((state) => state.setDefaultShell);
  const check = useCliProfilesStore((state) => state.check);
  const create = useCliProfilesStore((state) => state.create);
  const update = useCliProfilesStore((state) => state.update);
  const remove = useCliProfilesStore((state) => state.remove);
  const clearFailure = useCliProfilesStore((state) => state.clearFailure);

  /** Shell the user just chose, shown until the backend confirms or refuses the change. */
  const [pendingShellId, setPendingShellId] = useState<string | null>(null);
  /** Which profile the editor sheet is pointed at, or `null` while it is closed. */
  const [editor, setEditor] = useState<{
    mode: "create" | "edit";
    profileId: string | null;
  } | null>(null);
  /** Identifier the delete confirmation is pointed at, resolved against the live snapshot. */
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  /** True once an open surface lost the profile it was working on. */
  const [missingNotice, setMissingNotice] = useState(false);
  /** Last completed operation, announced politely without moving focus. */
  const [statusMessage, setStatusMessage] = useState("");
  /** Profile a confirmed deletion is currently removing, so its own vanishing is expected. */
  const deletingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { acquire, release } = useCliProfilesStore.getState();
    acquire();

    return release;
  }, []);

  // A profile can disappear because someone else deleted it. The confirmation then has nothing
  // left to confirm, so it closes and the page says why instead of failing on the next press.
  useEffect(() => {
    if (deleteProfileId === null || snapshot === null) {
      return;
    }
    if (deletingIdRef.current === deleteProfileId) {
      return;
    }
    if (!snapshot.profiles.some((profile) => profile.id === deleteProfileId)) {
      setDeleteProfileId(null);
      setMissingNotice(true);
    }
  }, [deleteProfileId, snapshot]);

  const isFirstLoad = snapshot === null && status !== "error";
  const isRefreshing = snapshot !== null && status === "loading";
  const isMutating = mutation !== null;
  const builtInProfiles = snapshot?.profiles.filter((profile) => profile.kind === "builtIn") ?? [];
  const customProfiles = snapshot?.profiles.filter((profile) => profile.kind === "custom") ?? [];
  const atProfileLimit = customProfiles.length >= MAX_CUSTOM_PROFILES;
  const shellFailure = failure?.operation === "setDefaultShell" ? failure : null;
  const editorFailure =
    failure?.operation === "create" || failure?.operation === "update" ? failure : null;
  const deleteFailure = failure?.operation === "delete" ? failure : null;
  const pageFailure =
    failure !== null &&
    failure.operation !== "setDefaultShell" &&
    failure.operation !== "load" &&
    editorFailure === null &&
    deleteFailure === null
      ? failure
      : null;
  // The editor always reads the live snapshot entry, which is how an external edit, a reset or
  // a deletion made elsewhere reaches an open sheet instead of being silently overwritten.
  const editorSource =
    editor?.mode === "edit"
      ? (snapshot?.profiles.find((profile) => profile.id === editor.profileId) ?? null)
      : null;
  const deleteTarget =
    deleteProfileId === null
      ? null
      : (snapshot?.profiles.find((profile) => profile.id === deleteProfileId) ?? null);

  /** Persist one chosen shell, showing the choice only until the backend answers. */
  const handleShellChange = (shellId: string): void => {
    setPendingShellId(shellId);
    void setDefaultShell(shellId).finally(() => {
      // Success adopts the committed snapshot; a refusal rolls the control back to it.
      setPendingShellId(null);
    });
  };

  /** Re-check one saved profile without ever launching it. */
  const handleCheck = (profileId: string): void => {
    void check(profileId);
  };

  /** Send one full replacement payload as a create or an update, as the sheet's mode requires. */
  const handleSave = (profileId: string | null, input: CliProfileInputDto): Promise<boolean> =>
    profileId === null ? create(input) : update(profileId, input);

  /** Close the sheet after a profile it was working on disappeared from the snapshot. */
  const handleMissing = (): void => {
    setEditor(null);
    setMissingNotice(true);
  };

  /** Delete one custom profile only after the user confirmed it by name. */
  const handleDelete = (profileId: string): void => {
    deletingIdRef.current = profileId;
    void remove(profileId).then((accepted) => {
      deletingIdRef.current = null;
      // A retryable refusal keeps the dialog open so the same button becomes a second attempt.
      if (accepted) {
        setDeleteProfileId(null);
        setStatusMessage("Profile deleted.");
        return;
      }
      // A target the backend no longer knows cannot be retried, so the dialog closes for good.
      if (useCliProfilesStore.getState().failure?.code === "profileNotFound") {
        setDeleteProfileId(null);
      }
    });
  };

  /** Close the confirmation and drop the failure it was explaining. */
  const handleCancelDelete = (): void => {
    setDeleteProfileId(null);
    if (deleteFailure !== null) {
      clearFailure();
    }
  };

  return (
    <SettingsSection
      description="Which shell opens by default and which tools appear on the New Session screen."
      title="Terminal & CLI Profiles"
    >
      {isFirstLoad && (
        <p aria-busy="true" className="text-[13px] text-muted">
          Loading CLI profiles…
        </p>
      )}

      {status === "error" && failure !== null && (
        <div className="flex max-w-[560px] flex-col items-start gap-3" role="alert">
          <p className="text-[13px] text-error">{failure.message}</p>
          {failure.retryable && (
            <Button onClick={() => refresh()} type="button" variant="outline">
              Try again
            </Button>
          )}
        </div>
      )}

      {snapshot !== null && (
        <div className="min-w-0">
          {listenerFailed && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-hairline bg-surface-card px-3.5 py-2.5">
              <p className="text-[13px] text-body">
                CLI profile status won't update automatically.
              </p>
              <Button onClick={() => refresh()} size="sm" type="button" variant="outline">
                Refresh
              </Button>
            </div>
          )}

          <p aria-live="polite" className="h-4 text-[12px] text-muted">
            {isMutating ? "Saving…" : isRefreshing ? "Refreshing…" : statusMessage}
          </p>

          <SettingRow
            description="Used by the Terminal profile and by any profile without its own shell."
            first
            label="Default shell"
          >
            <DefaultShellField
              defaultShellId={snapshot.defaultShellId}
              disabled={isMutating}
              effectiveDefaultShellId={snapshot.effectiveDefaultShellId}
              errorMessage={shellFailure?.message ?? null}
              onChange={handleShellChange}
              shells={snapshot.shells}
              value={pendingShellId ?? snapshot.defaultShellId}
            />
          </SettingRow>

          {(pageFailure !== null || missingNotice) && (
            <p className="mt-3 text-[13px] text-error" role="alert">
              {missingNotice ? "This profile no longer exists." : pageFailure?.message}
            </p>
          )}

          <h2 className="mt-8 mb-2 text-[13px] font-semibold text-body-strong">
            Built-in profiles
          </h2>
          <CliProfileTable
            actionsDisabled={isMutating}
            checkingProfileIds={checkingProfileIds}
            label="Built-in profiles"
            onCheck={handleCheck}
            profiles={builtInProfiles}
            showArguments={false}
          />

          <div className="mt-8 mb-2 flex items-center justify-between gap-4">
            <h2 className="text-[13px] font-semibold text-body-strong">Custom profiles</h2>
            <div className="flex items-center gap-3">
              {atProfileLimit && (
                <span className="text-[12px] text-muted">
                  Delete a custom profile before creating another.
                </span>
              )}
              <Button
                disabled={isMutating || atProfileLimit}
                onClick={() => {
                  setMissingNotice(false);
                  setStatusMessage("");
                  setEditor({ mode: "create", profileId: null });
                }}
                size="sm"
                type="button"
              >
                New Profile
              </Button>
            </div>
          </div>

          {customProfiles.length === 0 ? (
            <p className="rounded-md border border-hairline bg-canvas px-3.5 py-3 text-[13px] text-muted">
              No custom profiles yet.
            </p>
          ) : (
            <CliProfileTable
              actionsDisabled={isMutating}
              checkingProfileIds={checkingProfileIds}
              label="Custom profiles"
              onCheck={handleCheck}
              onDelete={(profile) => {
                setMissingNotice(false);
                setStatusMessage("");
                setDeleteProfileId(profile.id);
              }}
              onEdit={(profile) => {
                setMissingNotice(false);
                setStatusMessage("");
                setEditor({ mode: "edit", profileId: profile.id });
              }}
              profiles={customProfiles}
              showArguments
            />
          )}

          <CliProfileEditor
            failure={editorFailure}
            isChecking={
              editor?.profileId !== null && editor?.profileId !== undefined
                ? checkingProfileIds.has(editor.profileId)
                : false
            }
            mode={editor?.mode ?? "create"}
            onCheck={handleCheck}
            onClose={() => setEditor(null)}
            onMissing={handleMissing}
            onSave={handleSave}
            open={editor !== null}
            shells={snapshot.shells}
            source={editorSource}
          />

          <DeleteCliProfileDialog
            failure={deleteFailure}
            isPending={mutation?.kind === "delete" && mutation.profileId === deleteProfileId}
            onCancel={handleCancelDelete}
            onConfirm={handleDelete}
            target={deleteTarget}
          />
        </div>
      )}
    </SettingsSection>
  );
}
