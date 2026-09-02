import { invoke } from "@tauri-apps/api/core";

/** Every backend error the frontend understands is a discriminated union tagged by `code`. */
export interface TaggedIpcError {
  code: string;
}

/**
 * One failed command call. `payload` carries the tagged backend error when the rejection
 * matched the documented shape, and is `null` for anything else — a denied permission, a
 * transport failure, or a future error shape this build does not know yet.
 */
export class IpcCallError<TError extends TaggedIpcError> extends Error {
  readonly command: string;
  readonly payload: TError | null;

  // Build a failure that names the command so callers never have to guess the source.
  constructor(command: string, payload: TError | null) {
    super(
      payload === null
        ? `The command "${command}" failed with an unrecognized error.`
        : `The command "${command}" failed with code "${payload.code}".`,
    );
    this.name = "IpcCallError";
    this.command = command;
    this.payload = payload;
  }
}

// Recognize the documented `{ code }` shape. Anything else is deliberately not coerced,
// so a malformed rejection can never be mistaken for a known error code.
function asTaggedError<TError extends TaggedIpcError>(rejection: unknown): TError | null {
  if (typeof rejection !== "object" || rejection === null) {
    return null;
  }

  const code = (rejection as { code?: unknown }).code;

  return typeof code === "string" ? (rejection as TError) : null;
}

/**
 * Call one backend command and turn every rejection into an `IpcCallError`. This is the
 * only place the frontend touches `invoke`, so command names stay inside the adapter layer.
 */
export async function invokeCommand<TResult, TError extends TaggedIpcError>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  try {
    return await invoke<TResult>(command, args);
  } catch (rejection) {
    throw new IpcCallError<TError>(command, asTaggedError<TError>(rejection));
  }
}
