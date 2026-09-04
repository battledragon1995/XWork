import type { CloseImpactDto, SessionsError } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Copy for a failure at the window or contract boundary, which no retry can resolve. */
export const SESSIONS_INTEGRATION_MESSAGE =
  "XWork ran into a problem it cannot recover from. Restart XWork.";

/** The session-name rule, worded exactly as the rename dialog shows it. */
export const SESSION_NAME_REQUIREMENT = "Use 1 to 80 characters without control characters.";

/** Longest session name BE-005 accepts, counted in Unicode scalar values. */
const NAME_MAX_SCALARS = 80;

/** Control characters, the one class of input BE-005 rejects outright. */
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Most labels one fact row lists before the rest are folded into a remainder. */
const MAX_FACT_LABELS = 5;

/**
 * How a surface should react to one Sessions failure.
 *
 * - `missing` — the target is gone. Callers navigate away or drop the row; nothing to retry.
 * - `invalidName` — the typed name was refused, so the dialog stays open with the rule.
 * - `busy` — the runtime is mid-operation or shutting down. Waiting is the only recovery.
 * - `integration` — the window or the contract is wrong, so XWork has to be restarted.
 * - `unknown` — a transient backend failure or an unreadable rejection; `canRetry` decides.
 */
export type SessionsFailureKind = "missing" | "invalidName" | "busy" | "integration" | "unknown";

/** One classified Sessions failure, shared by both features so their copy cannot diverge. */
export interface SessionsFailure {
  kind: SessionsFailureKind;
  code: SessionsError["code"] | "unknown";
  message: string;
  canRetry: boolean;
}

/** Kind, copy and retry policy of every stable BE-005 code FE-006 can observe. */
const FAILURES: Record<
  SessionsError["code"],
  { kind: SessionsFailureKind; message: string; canRetry: boolean }
> = {
  unauthorizedWindow: {
    kind: "integration",
    message: SESSIONS_INTEGRATION_MESSAGE,
    canRetry: false,
  },
  projectNotFound: {
    kind: "missing",
    message: "That project is no longer in XWork.",
    canRetry: false,
  },
  projectUnavailable: {
    kind: "busy",
    message: "Sessions cannot start until the path is valid again.",
    canRetry: false,
  },
  projectLookupFailed: {
    kind: "unknown",
    message: "XWork couldn't start a session for this project.",
    canRetry: true,
  },
  profileNotFound: { kind: "missing", message: "That tool no longer exists.", canRetry: false },
  profileUnavailable: {
    kind: "busy",
    message: "That tool isn't available right now.",
    canRetry: false,
  },
  profileLookupFailed: {
    kind: "unknown",
    message: "XWork couldn't check that tool.",
    canRetry: true,
  },
  sessionNotFound: { kind: "missing", message: "That session is no longer open.", canRetry: false },
  tabNotFound: { kind: "missing", message: "That tab is no longer open.", canRetry: false },
  paneNotFound: { kind: "missing", message: "That pane is no longer open.", canRetry: false },
  splitNotFound: { kind: "missing", message: "That split is no longer open.", canRetry: false },
  invalidName: { kind: "invalidName", message: SESSION_NAME_REQUIREMENT, canRetry: false },
  invalidMove: { kind: "integration", message: SESSIONS_INTEGRATION_MESSAGE, canRetry: false },
  invalidSplitRatio: {
    kind: "integration",
    message: SESSIONS_INTEGRATION_MESSAGE,
    canRetry: false,
  },
  paneLimitReached: {
    kind: "integration",
    message: SESSIONS_INTEGRATION_MESSAGE,
    canRetry: false,
  },
  sessionNotEmpty: { kind: "busy", message: "This session already has a tab.", canRetry: false },
  paneNotEmpty: { kind: "busy", message: "That pane already has content.", canRetry: false },
  noClosedTab: {
    kind: "missing",
    message: "There is no closed tab to reopen.",
    canRetry: false,
  },
  confirmationRequired: {
    kind: "busy",
    message: "Confirm again to delete this session.",
    canRetry: false,
  },
  closeInProgress: { kind: "busy", message: "This session is closing.", canRetry: false },
  contentLifecycleFailed: {
    kind: "unknown",
    message: "XWork couldn't stop everything in this session.",
    canRetry: true,
  },
  runtimeShuttingDown: { kind: "busy", message: "XWork is shutting down.", canRetry: false },
};

/**
 * Read the tagged Sessions payload out of one rejection. Anything the adapter could not
 * recognize stays `null`, so a malformed rejection is never mistaken for a known code.
 */
export function sessionsErrorOf(rejection: unknown): SessionsError | null {
  return rejection instanceof IpcCallError ? (rejection.payload as SessionsError | null) : null;
}

/**
 * Sort one rejection into the shared kind, copy and retry policy. Operation-specific wording
 * stays with the owning hook: this table only answers what the backend said, never what the
 * surface that asked should show instead.
 */
export function classifySessionsFailure(rejection: unknown): SessionsFailure {
  const error = sessionsErrorOf(rejection);
  const known = error === null ? undefined : FAILURES[error.code];

  if (error === undefined || error === null || known === undefined) {
    return {
      kind: "unknown",
      code: "unknown",
      message: SESSIONS_INTEGRATION_MESSAGE,
      canRetry: false,
    };
  }

  return { kind: known.kind, code: error.code, message: known.message, canRetry: known.canRetry };
}

/**
 * Decide whether one typed session name can be submitted at all, and report the value that
 * would be sent. The rules mirror BE-005: trim first, then measure in scalar values so an
 * astral emoji counts once, and reject control characters. Duplicate names are valid.
 */
export function validateSessionName(raw: string): { isValid: boolean; value: string } {
  const value = raw.trim();
  const length = Array.from(value).length;
  const isValid = length >= 1 && length <= NAME_MAX_SCALARS && !CONTROL_CHARACTERS.test(value);

  return { isValid, value };
}

/**
 * Build one fact row from a count and its labels. The count is always the backend's, because
 * only it describes what will really be stopped; the labels are a bounded illustration whose
 * remainder is summarized rather than dropped silently.
 */
function factRow(count: number, labels: readonly string[], phrase: string): string {
  if (labels.length === 0) {
    return `${count} ${phrase}.`;
  }

  const shown = labels.slice(0, MAX_FACT_LABELS);
  const remaining = labels.length - shown.length;
  const listed = remaining > 0 ? `${shown.join(", ")}, +${remaining} more` : shown.join(", ");

  return `${count} ${phrase}: ${listed}`;
}

/**
 * List what deleting one session destroys, in the order the confirmation shows it. A zero
 * count renders no row at all, so the facts box states only measured blockers and disappears
 * entirely for a session with none.
 */
export function buildDeleteSessionFacts(impact: CloseImpactDto): readonly string[] {
  const facts: string[] = [];

  if (impact.runningProcessCount > 0) {
    facts.push(
      factRow(
        impact.runningProcessCount,
        impact.runningProcessLabels,
        impact.runningProcessCount === 1
          ? "running process will be stopped"
          : "running processes will be stopped",
      ),
    );
  }

  if (impact.unsavedFileCount > 0) {
    facts.push(
      factRow(
        impact.unsavedFileCount,
        impact.unsavedFileLabels,
        impact.unsavedFileCount === 1 ? "file with unsaved changes" : "files with unsaved changes",
      ),
    );
  }

  return facts;
}
