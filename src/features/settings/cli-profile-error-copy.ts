import type { CliProfilesError } from "@/bindings/terminal/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Known backend code, or the marker for a malformed or transport rejection. */
export type CliProfilesErrorCode = CliProfilesError["code"] | "unknown";

/** The four durable writes FE-013 serializes behind one slot. */
export type CliProfilesMutationKind = "create" | "update" | "delete" | "setDefaultShell";

/** Every operation whose failure the page has to explain differently. */
export type CliProfilesOperation = "load" | "refresh" | "check" | CliProfilesMutationKind;

/** Display-ready classification of one failed CLI profile operation. */
export interface CliProfilesFailure {
  code: CliProfilesErrorCode;
  operation: CliProfilesOperation;
  profileId: string | null;
  retryable: boolean;
  message: string;
}

/** The editor field or group an input rejection belongs next to. */
export type CliProfileErrorTarget =
  | "name"
  | "command"
  | "arguments"
  | "shell"
  | "icon"
  | "color"
  | "environment"
  | null;

/** Message used whenever a failure means the two layers disagree about the contract. */
const INTEGRATION_MESSAGE = "XWork ran into a CLI profile integration problem. Restart XWork.";

/** Message used for a backend code that cannot legitimately reach the command that got it. */
const UNEXPECTED_MESSAGE = "XWork couldn't complete that change.";

/** Every code the generated contract declares, so an unknown payload is never trusted. */
const KNOWN_CODES = new Set<string>([
  "unauthorizedWindow",
  "profileNotFound",
  "builtInProfileReadOnly",
  "tooManyProfiles",
  "invalidName",
  "invalidCommand",
  "invalidArguments",
  "invalidShell",
  "invalidIcon",
  "invalidColor",
  "invalidEnvironmentName",
  "duplicateEnvironmentName",
  "tooManyEnvironmentVariables",
  "invalidEnvironmentValue",
  "secretValueRequired",
  "commandNotFound",
  "shellNotFound",
  "credentialStoreUnavailable",
  "secretWriteFailed",
  "secretReadFailed",
  "secretNotFound",
  "commandResolutionFailed",
  "persistenceFailed",
]);

/**
 * Copy for every input rejection create and update share. None of these repeats the value
 * the user typed, so a command, a path or an environment value can never reach the message.
 */
const INPUT_MESSAGES: Partial<Record<CliProfilesErrorCode, string>> = {
  invalidName: "Enter a name between 1 and 80 characters.",
  invalidCommand: "Enter a bare executable name or an absolute path.",
  invalidArguments: "Check the arguments. A profile allows at most 128 rows and 32 KB in total.",
  invalidShell: "That shell is no longer in the catalog. Pick another shell.",
  invalidIcon: "Enter an icon between 1 and 16 characters.",
  invalidColor: "Use a #rrggbb colour.",
  invalidEnvironmentName:
    "Environment names must start with a letter or underscore and use only letters, digits and underscores.",
  duplicateEnvironmentName: "Environment names must be unique, ignoring upper and lower case.",
  tooManyEnvironmentVariables: "A profile allows at most 64 environment variables.",
  invalidEnvironmentValue: "One environment value is too long or contains a NUL character.",
  secretValueRequired: "Enter a value for the secret variable.",
  tooManyProfiles: "XWork already has 100 custom profiles. Delete one before creating another.",
};

/** Read the tagged CLI profile payload out of one rejection, or `null` when it had none. */
function readError(rejection: unknown): CliProfilesError | null {
  if (!(rejection instanceof IpcCallError) || rejection.payload === null) {
    return null;
  }

  const payload = rejection.payload as CliProfilesError;
  return KNOWN_CODES.has(payload.code) ? payload : null;
}

/** Extract only a code that belongs to the generated CLI profile error union. */
export function readCliProfilesErrorCode(rejection: unknown): CliProfilesErrorCode {
  return readError(rejection)?.code ?? "unknown";
}

/**
 * Compare two backend revisions as non-negative decimal integers. The backend counter is a
 * `u64`, which `Number` cannot represent exactly, so the comparison stays on the digits:
 * normalize away leading zeros, then order by length first and lexically second.
 */
export function compareCliProfileRevisions(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/, "");
  const b = right.replace(/^0+(?=\d)/, "");

  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** Resolve which editor field or group one backend input rejection belongs next to. */
export function readCliProfileErrorTarget(code: CliProfilesErrorCode): CliProfileErrorTarget {
  switch (code) {
    case "invalidName":
      return "name";
    case "invalidCommand":
      return "command";
    case "invalidArguments":
      return "arguments";
    case "invalidShell":
      return "shell";
    case "invalidIcon":
      return "icon";
    case "invalidColor":
      return "color";
    case "invalidEnvironmentName":
    case "duplicateEnvironmentName":
    case "tooManyEnvironmentVariables":
    case "invalidEnvironmentValue":
    case "secretValueRequired":
      return "environment";
    default:
      return null;
  }
}

/** Copy and recovery for one failed read, whether it was the first one or a refresh. */
function classifyRead(code: CliProfilesErrorCode): { message: string; retryable: boolean } {
  switch (code) {
    case "persistenceFailed":
    case "unknown":
      return { message: "XWork couldn't load CLI profiles.", retryable: true };
    default:
      return { message: INTEGRATION_MESSAGE, retryable: false };
  }
}

/** Copy and recovery for one failed availability check of a saved profile. */
function classifyCheck(code: CliProfilesErrorCode): { message: string; retryable: boolean } {
  switch (code) {
    case "profileNotFound":
      return { message: "This profile no longer exists.", retryable: false };
    case "commandResolutionFailed":
    case "persistenceFailed":
    case "unknown":
      return { message: "XWork couldn't check this command.", retryable: true };
    case "unauthorizedWindow":
      return { message: INTEGRATION_MESSAGE, retryable: false };
    default:
      // `commandNotFound` and `shellNotFound` belong in the availability status, never in a
      // rejection, so they are reported defensively rather than treated as a real result.
      return { message: UNEXPECTED_MESSAGE, retryable: false };
  }
}

/** Copy and recovery for one failed create or update of a custom profile. */
function classifyWrite(code: CliProfilesErrorCode): { message: string; retryable: boolean } {
  const inputMessage = INPUT_MESSAGES[code];
  if (inputMessage !== undefined) {
    return { message: inputMessage, retryable: false };
  }

  switch (code) {
    case "profileNotFound":
      return { message: "This profile no longer exists.", retryable: false };
    case "credentialStoreUnavailable":
      return {
        message: "XWork couldn't reach the operating system credential store.",
        retryable: true,
      };
    case "secretWriteFailed":
      return { message: "XWork couldn't save the secret value.", retryable: true };
    case "persistenceFailed":
    case "unknown":
      return { message: "XWork couldn't save this profile.", retryable: true };
    case "unauthorizedWindow":
    case "builtInProfileReadOnly":
      return { message: INTEGRATION_MESSAGE, retryable: false };
    default:
      return { message: UNEXPECTED_MESSAGE, retryable: false };
  }
}

/** Copy and recovery for one failed deletion of a custom profile. */
function classifyDelete(code: CliProfilesErrorCode): { message: string; retryable: boolean } {
  switch (code) {
    case "profileNotFound":
      return { message: "This profile no longer exists.", retryable: false };
    case "persistenceFailed":
    case "unknown":
      return { message: "XWork couldn't delete this profile.", retryable: true };
    case "unauthorizedWindow":
    case "builtInProfileReadOnly":
      return { message: INTEGRATION_MESSAGE, retryable: false };
    default:
      return { message: UNEXPECTED_MESSAGE, retryable: false };
  }
}

/** Copy and recovery for one failed default-shell change. */
function classifyDefaultShell(code: CliProfilesErrorCode): { message: string; retryable: boolean } {
  switch (code) {
    case "invalidShell":
      return {
        message: "That shell is no longer in the catalog. Pick another shell.",
        retryable: false,
      };
    case "shellNotFound":
      return {
        message: "That shell isn't available on this computer. Pick another shell.",
        retryable: false,
      };
    case "persistenceFailed":
    case "unknown":
      return { message: "XWork couldn't save the default shell.", retryable: true };
    case "unauthorizedWindow":
      return { message: INTEGRATION_MESSAGE, retryable: false };
    default:
      return { message: UNEXPECTED_MESSAGE, retryable: false };
  }
}

/**
 * Turn one rejection into the message, recovery and placement FE-013 assigns it. Only the
 * tagged `code` is read: the implemented contract carries no `message` or `field`, and raw
 * rejection text is never shown because it can quote a path, an account or a value.
 */
export function classifyCliProfilesFailure(
  rejection: unknown,
  operation: CliProfilesOperation,
  profileId: string | null,
): CliProfilesFailure {
  const code = readCliProfilesErrorCode(rejection);
  const resolved =
    operation === "load" || operation === "refresh"
      ? classifyRead(code)
      : operation === "check"
        ? classifyCheck(code)
        : operation === "delete"
          ? classifyDelete(code)
          : operation === "setDefaultShell"
            ? classifyDefaultShell(code)
            : classifyWrite(code);

  return { code, operation, profileId, ...resolved };
}
