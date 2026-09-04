import { useCallback, useEffect, useRef, useState } from "react";
import type { CliProfilesError, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import {
  checkCliProfile,
  getCliProfiles,
  onCliProfilesChanged,
  type UnlistenFn,
} from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Copy for a catalog that could not be read at all. */
export const CATALOG_LOAD_FAILED_MESSAGE = "XWork couldn't load your CLI profiles.";

/** Copy for an availability check that could not be completed. */
export const CATALOG_CHECK_FAILED_MESSAGE = "XWork couldn't check that tool.";

/** Copy for a profile that disappeared between rendering the card and acting on it. */
export const CATALOG_PROFILE_GONE_MESSAGE = "That tool no longer exists.";

/**
 * One failed catalog operation, in the only two shapes the picker distinguishes.
 *
 * The Settings feature has a far richer classification of the same backend errors, but the
 * two features must not import each other's implementation: the picker only reads and
 * re-checks, so it needs a fraction of that vocabulary and keeps its own.
 */
export interface CliProfilesFailure {
  operation: "load" | "check";
  code: CliProfilesError["code"] | "unknown";
  profileId: string | null;
  message: string;
  canRetry: boolean;
}

/** What the tool picker reads about the BE-006 catalog. */
export interface ToolCatalogData {
  status: "loading" | "ready" | "error";
  snapshot: CliProfilesSnapshotDto | null;
  checkingProfileIds: ReadonlySet<string>;
  /** Profiles the backend just refused, marked until the next accepted snapshot replaces it. */
  unavailableProfileIds: ReadonlySet<string>;
  failure: CliProfilesFailure | null;
  refresh(): void;
  check(profileId: string): Promise<void>;
  markUnavailable(profileId: string): void;
}

/** Everything the hook publishes, kept as one value so it always updates atomically. */
interface CatalogState {
  status: ToolCatalogData["status"];
  snapshot: CliProfilesSnapshotDto | null;
  checkingProfileIds: ReadonlySet<string>;
  unavailableProfileIds: ReadonlySet<string>;
  failure: CliProfilesFailure | null;
}

const INITIAL_STATE: CatalogState = {
  status: "loading",
  snapshot: null,
  checkingProfileIds: new Set<string>(),
  unavailableProfileIds: new Set<string>(),
  failure: null,
};

/** Read the tagged CLI profile payload out of one rejection, or `null` when it had none. */
function readErrorCode(rejection: unknown): CliProfilesError["code"] | "unknown" {
  if (!(rejection instanceof IpcCallError) || rejection.payload === null) {
    return "unknown";
  }

  return (rejection.payload as CliProfilesError).code;
}

/**
 * Read the BE-006 profile catalog for the tool picker and re-check one profile at a time.
 *
 * The hook treats `cli-profiles://changed` strictly as an invalidation signal: the payload
 * carries no configuration, and a `check_cli_profile` result carries no revision, so the only
 * thing that ever becomes displayed state is a whole snapshot read.
 */
export function useToolCatalog(): ToolCatalogData {
  const [state, setState] = useState<CatalogState>(INITIAL_STATE);

  /** Newest snapshot read. A read publishes only while its token still matches. */
  const requestToken = useRef(0);
  /** Bumped on unmount so a check that answers afterwards publishes nothing. */
  const generation = useRef(0);
  /**
   * Mirrors the in-flight checks so the guard reads what is already committed rather than
   * what this render closed over; two presses in the same tick would otherwise both pass.
   */
  const checkingRef = useRef<Set<string>>(new Set<string>());

  const refresh = useCallback(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    const currentGeneration = generation.current;

    setState((current) => ({
      ...current,
      // A retained snapshot keeps the grid on screen while a refresh runs; only a first read
      // shows the placeholders.
      status: current.snapshot === null ? "loading" : current.status,
      failure: current.failure?.operation === "load" ? null : current.failure,
    }));

    getCliProfiles()
      .then((snapshot) => {
        if (token !== requestToken.current || currentGeneration !== generation.current) {
          return;
        }

        setState((current) => ({
          ...current,
          status: "ready",
          snapshot,
          // A fresh snapshot is the authority on availability, so every temporary marker the
          // picker added from a refused selection is dropped with it.
          unavailableProfileIds: new Set<string>(),
          failure: current.failure?.operation === "load" ? null : current.failure,
        }));
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken.current || currentGeneration !== generation.current) {
          return;
        }

        setState((current) => ({
          ...current,
          // A retained snapshot is better than an error screen, so the failure only replaces
          // the grid when there is nothing to show.
          status: current.snapshot === null ? "error" : "ready",
          failure: {
            operation: "load",
            code: readErrorCode(rejection),
            profileId: null,
            message: CATALOG_LOAD_FAILED_MESSAGE,
            canRetry: true,
          },
        }));
      });
  }, []);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const check = useCallback(async (profileId: string) => {
    if (checkingRef.current.has(profileId)) {
      // A second press on the same card is dropped; other cards stay independent, which is
      // why the flag is tracked per profile rather than as one global marker.
      return;
    }

    const currentGeneration = generation.current;
    checkingRef.current.add(profileId);
    setState((current) => ({
      ...current,
      checkingProfileIds: new Set(current.checkingProfileIds).add(profileId),
      failure: current.failure?.profileId === profileId ? null : current.failure,
    }));

    try {
      await checkCliProfile(profileId);
      if (currentGeneration !== generation.current) {
        return;
      }

      // The returned profile carries no revision, so it is never display authority: the new
      // availability reaches the card only through a whole snapshot read.
      refreshRef.current();
    } catch (rejection: unknown) {
      if (currentGeneration !== generation.current) {
        return;
      }

      const code = readErrorCode(rejection);
      setState((current) => ({
        ...current,
        failure: {
          operation: "check",
          code,
          profileId,
          message:
            code === "profileNotFound"
              ? CATALOG_PROFILE_GONE_MESSAGE
              : CATALOG_CHECK_FAILED_MESSAGE,
          canRetry: code !== "profileNotFound",
        },
      }));

      if (code === "profileNotFound") {
        // The card the user acted on is stale, so the picker needs the committed catalog.
        refreshRef.current();
      }
    } finally {
      checkingRef.current.delete(profileId);
      if (currentGeneration === generation.current) {
        setState((current) => {
          const next = new Set(current.checkingProfileIds);
          next.delete(profileId);
          return { ...current, checkingProfileIds: next };
        });
      }
    }
  }, []);

  const markUnavailable = useCallback((profileId: string) => {
    setState((current) => ({
      ...current,
      unavailableProfileIds: new Set(current.unavailableProfileIds).add(profileId),
    }));
  }, []);

  // Read the catalog once and subscribe to invalidation for as long as the picker is mounted.
  useEffect(() => {
    let isCurrent = true;
    let unlistenFn: UnlistenFn | null = null;
    refreshRef.current();

    void onCliProfilesChanged(() => {
      // The payload is an invalidation hint only, so the whole snapshot is read again.
      refreshRef.current();
    })
      .then((unlisten) => {
        if (!isCurrent) {
          // Registration lost the race with unmounting, so remove it right away.
          unlisten();
          return;
        }

        unlistenFn = unlisten;
      })
      .catch(() => {
        // Without live updates the picker still works: `Check again` reads a fresh snapshot
        // itself, so there is nothing technical to put in front of the user.
      });

    return () => {
      isCurrent = false;
      generation.current += 1;
      requestToken.current += 1;
      unlistenFn?.();
    };
  }, []);

  return {
    status: state.status,
    snapshot: state.snapshot,
    checkingProfileIds: state.checkingProfileIds,
    unavailableProfileIds: state.unavailableProfileIds,
    failure: state.failure,
    refresh,
    check,
    markUnavailable,
  };
}
