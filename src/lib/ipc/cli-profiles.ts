import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CliProfileDto,
  CliProfileInputDto,
  CliProfilesChangedDto,
  CliProfilesError,
  CliProfilesSnapshotDto,
} from "@/bindings/terminal/cli-profiles";
import { invokeCommand } from "./ipc-error";

/** Re-exported so the Settings feature can type a subscription without importing Tauri. */
export type { UnlistenFn };

/** Event BE-006 emits whenever the persisted profile or shell catalog is no longer current. */
const CLI_PROFILES_CHANGED_EVENT = "cli-profiles://changed";

// Call one CLI profile command with the shared error normalization of this layer.
function invokeCliProfiles<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, CliProfilesError>(command, args);
}

/** Read the complete profile and shell catalog snapshot. */
export function getCliProfiles(): Promise<CliProfilesSnapshotDto> {
  return invokeCliProfiles<CliProfilesSnapshotDto>("get_cli_profiles");
}

/** Create one custom profile and return the whole post-commit snapshot. */
export function createCliProfile(input: CliProfileInputDto): Promise<CliProfilesSnapshotDto> {
  return invokeCliProfiles<CliProfilesSnapshotDto>("create_cli_profile", { input });
}

/**
 * Replace one custom profile completely. `profileId` is the camelCase name Tauri maps to the
 * Rust `profile_id` parameter; the configuration stays a separate field so no caller is ever
 * tempted to fold an identifier into the payload.
 */
export function updateCliProfile(
  profileId: string,
  input: CliProfileInputDto,
): Promise<CliProfilesSnapshotDto> {
  return invokeCliProfiles<CliProfilesSnapshotDto>("update_cli_profile", { profileId, input });
}

/** Delete one custom profile and return the whole post-commit snapshot. */
export function deleteCliProfile(profileId: string): Promise<CliProfilesSnapshotDto> {
  return invokeCliProfiles<CliProfilesSnapshotDto>("delete_cli_profile", { profileId });
}

/** Persist the default shell by its stable catalog id and return the post-commit snapshot. */
export function setDefaultCliShell(shellId: string): Promise<CliProfilesSnapshotDto> {
  return invokeCliProfiles<CliProfilesSnapshotDto>("set_default_cli_shell", { shellId });
}

/**
 * Re-check one saved profile's launch availability. The backend answers with that profile
 * only and carries no revision, so callers still have to read a fresh snapshot afterwards.
 */
export function checkCliProfile(profileId: string): Promise<CliProfileDto> {
  return invokeCliProfiles<CliProfileDto>("check_cli_profile", { profileId });
}

/**
 * Subscribe to catalog invalidation. The payload is forwarded verbatim but is only ever an
 * invalidation hint: it carries no profile configuration to patch state with.
 */
export function onCliProfilesChanged(
  handler: (event: CliProfilesChangedDto) => void,
): Promise<UnlistenFn> {
  return listen<CliProfilesChangedDto>(
    CLI_PROFILES_CHANGED_EVENT,
    (event: Event<CliProfilesChangedDto>) => {
      handler(event.payload);
    },
  );
}
