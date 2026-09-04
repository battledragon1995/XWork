import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfileInputDto, CliProfilesError } from "@/bindings/terminal/cli-profiles";
import {
  checkCliProfile,
  createCliProfile,
  deleteCliProfile,
  getCliProfiles,
  onCliProfilesChanged,
  setDefaultCliShell,
  updateCliProfile,
} from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  classifyCliProfilesFailure,
  compareCliProfileRevisions,
  readCliProfileErrorTarget,
} from "./cli-profile-error-copy";
import { resetCliProfilesStore, useCliProfilesStore } from "./cli-profiles-store";
import {
  createCliProfileDto,
  createCliProfilesSnapshot,
  createCliShellDto,
} from "./cli-profiles-test-fixture";

// Replace the only boundary this store owns so no case reaches Tauri or real profile data.
vi.mock("@/lib/ipc/cli-profiles", () => ({
  getCliProfiles: vi.fn(),
  createCliProfile: vi.fn(),
  updateCliProfile: vi.fn(),
  deleteCliProfile: vi.fn(),
  setDefaultCliShell: vi.fn(),
  checkCliProfile: vi.fn(),
  onCliProfilesChanged: vi.fn(),
}));

const getCliProfilesMock = vi.mocked(getCliProfiles);
const createCliProfileMock = vi.mocked(createCliProfile);
const updateCliProfileMock = vi.mocked(updateCliProfile);
const deleteCliProfileMock = vi.mocked(deleteCliProfile);
const setDefaultCliShellMock = vi.mocked(setDefaultCliShell);
const checkCliProfileMock = vi.mocked(checkCliProfile);
const onCliProfilesChangedMock = vi.mocked(onCliProfilesChanged);

/** One create/update payload; its contents never matter to the store itself. */
const INPUT: CliProfileInputDto = {
  name: "Gemini CLI",
  command: "gemini",
  arguments: [],
  icon: "Ge",
  color: "#5db8a6",
  environment: [],
};

/** Build one promise whose settlement a case controls, so races are deterministic. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // A rejected deferred that nobody has awaited yet must not trip the unhandled handler.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Let every already settled promise callback run before the next assertion. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Build one tagged rejection exactly as the shared IPC boundary produces it. */
function tagged(code: CliProfilesError["code"]): IpcCallError<CliProfilesError> {
  return new IpcCallError<CliProfilesError>("get_cli_profiles", { code } as CliProfilesError);
}

/** Read the store state without subscribing a React component to it. */
function state() {
  return useCliProfilesStore.getState();
}

/** Capture the invalidation callback the store registered, if any. */
function emitChange(): void {
  const handler = onCliProfilesChangedMock.mock.calls.at(-1)?.[0];
  handler?.({ revision: "99", kind: "availabilityChanged", profileId: null });
}

beforeEach(() => {
  resetCliProfilesStore();
  getCliProfilesMock.mockReset().mockResolvedValue(createCliProfilesSnapshot());
  createCliProfileMock.mockReset();
  updateCliProfileMock.mockReset();
  deleteCliProfileMock.mockReset();
  setDefaultCliShellMock.mockReset();
  checkCliProfileMock.mockReset();
  onCliProfilesChangedMock.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  resetCliProfilesStore();
});

describe("compareCliProfileRevisions", () => {
  // Verify ordering stays exact for values a JavaScript number could not represent.
  it.each([
    ["0", "0", 0],
    ["0", "1", -1],
    ["2", "10", -1],
    ["10", "2", 1],
    ["007", "7", 0],
    ["18446744073709551615", "18446744073709551614", 1],
    ["9999999999999999999", "18446744073709551615", -1],
  ])("compares %s with %s", (left, right, expected) => {
    expect(Math.sign(compareCliProfileRevisions(left, right))).toBe(expected);
  });
});

describe("classifyCliProfilesFailure", () => {
  /** Every generated code paired with the operation that can legitimately produce it. */
  const CASES: ReadonlyArray<{
    code: CliProfilesError["code"];
    operation: Parameters<typeof classifyCliProfilesFailure>[1];
    retryable: boolean;
  }> = [
    { code: "persistenceFailed", operation: "load", retryable: true },
    { code: "unauthorizedWindow", operation: "load", retryable: false },
    { code: "persistenceFailed", operation: "refresh", retryable: true },
    { code: "invalidName", operation: "create", retryable: false },
    { code: "invalidCommand", operation: "create", retryable: false },
    { code: "invalidArguments", operation: "create", retryable: false },
    { code: "invalidShell", operation: "create", retryable: false },
    { code: "invalidIcon", operation: "create", retryable: false },
    { code: "invalidColor", operation: "create", retryable: false },
    { code: "invalidEnvironmentName", operation: "create", retryable: false },
    { code: "duplicateEnvironmentName", operation: "create", retryable: false },
    { code: "tooManyEnvironmentVariables", operation: "create", retryable: false },
    { code: "invalidEnvironmentValue", operation: "create", retryable: false },
    { code: "secretValueRequired", operation: "create", retryable: false },
    { code: "tooManyProfiles", operation: "create", retryable: false },
    { code: "credentialStoreUnavailable", operation: "create", retryable: true },
    { code: "secretWriteFailed", operation: "create", retryable: true },
    { code: "persistenceFailed", operation: "create", retryable: true },
    { code: "profileNotFound", operation: "update", retryable: false },
    { code: "builtInProfileReadOnly", operation: "update", retryable: false },
    { code: "profileNotFound", operation: "delete", retryable: false },
    { code: "persistenceFailed", operation: "delete", retryable: true },
    { code: "invalidShell", operation: "setDefaultShell", retryable: false },
    { code: "shellNotFound", operation: "setDefaultShell", retryable: false },
    { code: "persistenceFailed", operation: "setDefaultShell", retryable: true },
    { code: "profileNotFound", operation: "check", retryable: false },
    { code: "commandResolutionFailed", operation: "check", retryable: true },
    { code: "commandNotFound", operation: "check", retryable: false },
    { code: "shellNotFound", operation: "check", retryable: false },
    { code: "secretReadFailed", operation: "update", retryable: false },
    { code: "secretNotFound", operation: "update", retryable: false },
  ];

  // Verify every generated code produces intentional, non-empty copy in a valid operation.
  it.each(CASES)("classifies $code during $operation", ({ code, operation, retryable }) => {
    const failure = classifyCliProfilesFailure(tagged(code), operation, "p1");

    expect(failure).toMatchObject({ code, operation, profileId: "p1", retryable });
    expect(failure.message.length).toBeGreaterThan(0);
  });

  // Verify a rejection the boundary could not read is never mistaken for a backend code.
  it.each([
    ["load", true],
    ["refresh", true],
    ["create", true],
    ["update", true],
    ["delete", true],
    ["setDefaultShell", true],
    ["check", true],
  ] as const)("treats an unknown %s rejection as retryable=%s", (operation, retryable) => {
    const failure = classifyCliProfilesFailure(new Error("transport"), operation, null);

    expect(failure.code).toBe("unknown");
    expect(failure.retryable).toBe(retryable);
  });

  // Verify no message can leak a command, an environment value, an account or raw error text.
  it("never repeats sensitive rejection detail in its copy", () => {
    const rejection = new IpcCallError<CliProfilesError>("create_cli_profile", {
      code: "secretWriteFailed",
    } as CliProfilesError);
    const leaky = new Error("C:/secret/path/gemini.exe OPENAI_API_KEY=sk-live-1234 account=nhannt");

    for (const operation of ["create", "update", "delete", "check", "load"] as const) {
      for (const thrown of [rejection, leaky]) {
        const { message } = classifyCliProfilesFailure(thrown, operation, null);
        expect(message).not.toMatch(/sk-live|OPENAI_API_KEY|gemini\.exe|account=|C:\//);
      }
    }
  });
});

describe("readCliProfileErrorTarget", () => {
  // Verify each input code lands on the field or group the editor should highlight.
  it.each([
    ["invalidName", "name"],
    ["invalidCommand", "command"],
    ["invalidArguments", "arguments"],
    ["invalidShell", "shell"],
    ["invalidIcon", "icon"],
    ["invalidColor", "color"],
    ["invalidEnvironmentName", "environment"],
    ["duplicateEnvironmentName", "environment"],
    ["tooManyEnvironmentVariables", "environment"],
    ["invalidEnvironmentValue", "environment"],
    ["secretValueRequired", "environment"],
    ["persistenceFailed", null],
    ["unknown", null],
  ] as const)("maps %s to %s", (code, target) => {
    expect(readCliProfileErrorTarget(code)).toBe(target);
  });
});

describe("consumer lifecycle", () => {
  // Verify only the first consumer creates work, so page and future consumers share one read.
  it("registers one listener and one read for the first consumer", async () => {
    state().acquire();
    state().acquire();
    await flush();

    expect(onCliProfilesChangedMock).toHaveBeenCalledOnce();
    expect(getCliProfilesMock).toHaveBeenCalledOnce();
    expect(state().status).toBe("ready");
    expect(state().consumerCount).toBe(2);
  });

  // Verify the last release removes the listener and drops transient error state only.
  it("removes the listener and clears transient state on the final release", async () => {
    const unlisten = vi.fn();
    onCliProfilesChangedMock.mockResolvedValue(unlisten);

    state().acquire();
    state().acquire();
    await flush();
    useCliProfilesStore.setState({
      failure: classifyCliProfilesFailure(tagged("persistenceFailed"), "refresh", null),
    });

    state().release();
    expect(unlisten).not.toHaveBeenCalled();

    state().release();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(state().failure).toBeNull();
    expect(state().snapshot).not.toBeNull();
    expect(state().consumerCount).toBe(0);
  });

  // Verify a registration that wins its race after the final release is disposed immediately.
  it("disposes a listener registered after the final release", async () => {
    const unlisten = vi.fn();
    const registration = deferred<() => void>();
    onCliProfilesChangedMock.mockReturnValue(registration.promise);

    state().acquire();
    state().release();
    registration.resolve(unlisten);
    await flush();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  // Verify a refused registration still leaves a usable snapshot plus a non-blocking warning.
  it("keeps commands usable when the listener cannot be registered", async () => {
    onCliProfilesChangedMock.mockRejectedValue(new Error("refused"));

    state().acquire();
    await flush();

    expect(state().listenerFailed).toBe(true);
    expect(state().status).toBe("ready");
    expect(state().snapshot).not.toBeNull();
  });

  // Verify a read that answers after unmount cannot publish into the released store.
  it("invalidates a read still in flight when the last consumer leaves", async () => {
    const read = deferred<ReturnType<typeof createCliProfilesSnapshot>>();
    getCliProfilesMock.mockReturnValue(read.promise);

    state().acquire();
    state().release();
    read.resolve(createCliProfilesSnapshot({ revision: "5" }));
    await flush();

    expect(state().snapshot).toBeNull();
    expect(state().status).toBe("idle");
  });
});

describe("reading and refreshing", () => {
  // Verify the first read moves through loading and publishes the backend snapshot.
  it("loads the initial snapshot", async () => {
    const snapshot = createCliProfilesSnapshot({ revision: "3" });
    const read = deferred<typeof snapshot>();
    getCliProfilesMock.mockReturnValue(read.promise);

    state().acquire();
    expect(state().status).toBe("loading");

    read.resolve(snapshot);
    await flush();

    expect(state().status).toBe("ready");
    expect(state().snapshot).toBe(snapshot);
  });

  // Verify a first-read failure is an error state with a retryable load failure.
  it("reports a first-read failure without a snapshot", async () => {
    getCliProfilesMock.mockRejectedValue(tagged("persistenceFailed"));

    state().acquire();
    await flush();

    expect(state().status).toBe("error");
    expect(state().snapshot).toBeNull();
    expect(state().failure).toMatchObject({ operation: "load", retryable: true });
  });

  // Verify a later failure keeps the committed snapshot on screen instead of blanking it.
  it("keeps the cached snapshot when a refresh fails", async () => {
    state().acquire();
    await flush();
    const cached = state().snapshot;

    getCliProfilesMock.mockRejectedValue(tagged("persistenceFailed"));
    state().refresh();
    await flush();

    expect(state().snapshot).toBe(cached);
    expect(state().status).toBe("ready");
    expect(state().failure).toMatchObject({ operation: "refresh", retryable: true });
  });

  // Verify a burst of invalidation events during one read collapses into a single extra read.
  it("coalesces an event burst into at most one queued refresh", async () => {
    const first = deferred<ReturnType<typeof createCliProfilesSnapshot>>();
    getCliProfilesMock.mockReturnValue(first.promise);

    state().acquire();
    await flush();
    emitChange();
    emitChange();
    emitChange();
    expect(getCliProfilesMock).toHaveBeenCalledOnce();

    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "2" }));
    first.resolve(createCliProfilesSnapshot({ revision: "1" }));
    await flush();

    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
    expect(state().snapshot?.revision).toBe("2");
  });

  // Verify a refresh with a retained snapshot is observable, which is what drives `Refreshing…`.
  it("reports a refresh over a retained snapshot as loading", async () => {
    state().acquire();
    await flush();

    const second = deferred<ReturnType<typeof createCliProfilesSnapshot>>();
    getCliProfilesMock.mockReturnValue(second.promise);
    state().refresh();

    expect(state().status).toBe("loading");
    expect(state().snapshot).not.toBeNull();

    second.resolve(createCliProfilesSnapshot({ revision: "1" }));
    await flush();
    expect(state().status).toBe("ready");
  });

  // Verify an older revision can never replace a newer one, whichever response lands last.
  it("rejects a snapshot whose revision is older than the current one", async () => {
    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "10" }));
    state().acquire();
    await flush();

    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "9" }));
    state().refresh();
    await flush();

    expect(state().snapshot?.revision).toBe("10");
  });

  // Verify an equal revision is still accepted, because it is the same committed state.
  it("accepts a snapshot with an equal revision", async () => {
    state().acquire();
    await flush();

    const replacement = createCliProfilesSnapshot({ revision: "0", defaultShellId: "pwsh" });
    getCliProfilesMock.mockResolvedValue(replacement);
    state().refresh();
    await flush();

    expect(state().snapshot).toBe(replacement);
  });
});

describe("persistent mutations", () => {
  // Verify a committed snapshot from a mutation replaces the whole state, not a patch of it.
  it.each([
    ["create", () => state().create(INPUT), createCliProfileMock],
    ["update", () => state().update("p1", INPUT), updateCliProfileMock],
    ["delete", () => state().remove("p1"), deleteCliProfileMock],
    ["setDefaultShell", () => state().setDefaultShell("pwsh"), setDefaultCliShellMock],
  ] as const)("applies the committed snapshot returned by %s", async (_kind, call, mock) => {
    state().acquire();
    await flush();

    const committed = createCliProfilesSnapshot({ revision: "4", defaultShellId: "pwsh" });
    mock.mockResolvedValue(committed);

    await expect(call()).resolves.toBe(true);
    expect(state().snapshot).toBe(committed);
    expect(state().mutation).toBeNull();
  });

  // Verify only one durable write can cross the boundary at a time.
  it("permits one persistent mutation at a time", async () => {
    state().acquire();
    await flush();
    const write = deferred<ReturnType<typeof createCliProfilesSnapshot>>();
    createCliProfileMock.mockReturnValue(write.promise);

    const first = state().create(INPUT);
    expect(state().mutation).toEqual({ kind: "create", profileId: null });

    await expect(state().remove("p1")).resolves.toBe(false);
    expect(deleteCliProfileMock).not.toHaveBeenCalled();

    write.resolve(createCliProfilesSnapshot({ revision: "5" }));
    await expect(first).resolves.toBe(true);
    expect(state().mutation).toBeNull();
  });

  // Verify a mutation response older than the current snapshot cannot roll state backwards.
  it("rejects a stale mutation response", async () => {
    getCliProfilesMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "12" }));
    state().acquire();
    await flush();

    setDefaultCliShellMock.mockResolvedValue(createCliProfilesSnapshot({ revision: "11" }));
    await state().setDefaultShell("pwsh");

    expect(state().snapshot?.revision).toBe("12");
  });

  // Verify a failed mutation keeps committed data and records an operation-specific failure.
  it("records a mutation failure without discarding the snapshot", async () => {
    state().acquire();
    await flush();
    const cached = state().snapshot;
    createCliProfileMock.mockRejectedValue(tagged("credentialStoreUnavailable"));

    await expect(state().create(INPUT)).resolves.toBe(false);

    expect(state().snapshot).toBe(cached);
    expect(state().failure).toMatchObject({
      code: "credentialStoreUnavailable",
      operation: "create",
      retryable: true,
    });
    expect(state().mutation).toBeNull();
  });

  // Verify a vanished target triggers a refresh so the page can drop the stale row.
  it("refreshes after a profileNotFound rejection", async () => {
    state().acquire();
    await flush();
    deleteCliProfileMock.mockRejectedValue(tagged("profileNotFound"));

    await expect(state().remove("p1")).resolves.toBe(false);
    await flush();

    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
    expect(state().failure?.code).toBe("profileNotFound");
  });

  // Verify a refused default-shell change leaves the committed selection untouched.
  it("keeps the committed default shell when the change is refused", async () => {
    state().acquire();
    await flush();
    setDefaultCliShellMock.mockRejectedValue(tagged("shellNotFound"));

    await expect(state().setDefaultShell("cmd")).resolves.toBe(false);

    expect(state().snapshot?.defaultShellId).toBe("system");
    expect(state().failure).toMatchObject({
      code: "shellNotFound",
      operation: "setDefaultShell",
      retryable: false,
    });
  });

  // Verify an invalid shell refreshes the catalog the user has to choose from again.
  it("refreshes the catalog after an invalidShell rejection", async () => {
    state().acquire();
    await flush();
    setDefaultCliShellMock.mockRejectedValue(tagged("invalidShell"));

    await state().setDefaultShell("cmd");
    await flush();

    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
  });

  // Verify a mutation answering after unmount cannot publish into the released store.
  it("ignores a mutation that settles after the last consumer left", async () => {
    state().acquire();
    await flush();
    const write = deferred<ReturnType<typeof createCliProfilesSnapshot>>();
    createCliProfileMock.mockReturnValue(write.promise);

    const pending = state().create(INPUT);
    state().release();
    write.resolve(createCliProfilesSnapshot({ revision: "40" }));

    await expect(pending).resolves.toBe(false);
    expect(state().snapshot?.revision).toBe("0");
  });
});

describe("availability checks", () => {
  // Verify one check marks its own row, ignores the returned DTO and reloads the snapshot.
  it("tracks the checked profile and refreshes afterwards", async () => {
    state().acquire();
    await flush();
    const check = deferred<ReturnType<typeof createCliProfileDto>>();
    checkCliProfileMock.mockReturnValue(check.promise);

    const pending = state().check("builtin:codex");
    expect(state().checkingProfileIds.has("builtin:codex")).toBe(true);

    check.resolve(createCliProfileDto({ id: "builtin:codex", name: "Renamed by nobody" }));
    await expect(pending).resolves.toBe(true);
    await flush();

    // The check result carries no revision, so only the extra read may change store state.
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
    expect(state().checkingProfileIds.has("builtin:codex")).toBe(false);
    expect(state().snapshot?.profiles.some((p) => p.name === "Renamed by nobody")).toBe(false);
  });

  // Verify a duplicate press on the same row is suppressed while a different row is allowed.
  it("suppresses a duplicate check for the same profile", async () => {
    state().acquire();
    await flush();
    const check = deferred<ReturnType<typeof createCliProfileDto>>();
    checkCliProfileMock.mockReturnValue(check.promise);

    const first = state().check("builtin:codex");
    await expect(state().check("builtin:codex")).resolves.toBe(false);
    expect(checkCliProfileMock).toHaveBeenCalledOnce();

    void state().check("builtin:claude");
    expect(checkCliProfileMock).toHaveBeenCalledTimes(2);

    check.resolve(createCliProfileDto());
    await first;
  });

  // Verify a slow check clearing its own row cannot erase the marker of a newer one.
  it("clears only its own row when two checks overlap", async () => {
    state().acquire();
    await flush();
    const first = deferred<ReturnType<typeof createCliProfileDto>>();
    const second = deferred<ReturnType<typeof createCliProfileDto>>();
    checkCliProfileMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const firstCheck = state().check("builtin:codex");
    void state().check("builtin:claude");

    first.resolve(createCliProfileDto());
    await firstCheck;

    expect(state().checkingProfileIds.has("builtin:codex")).toBe(false);
    expect(state().checkingProfileIds.has("builtin:claude")).toBe(true);
    second.resolve(createCliProfileDto());
    await flush();
  });

  // Verify a failed check keeps the previous availability and records a check failure.
  it("records a check failure without changing availability", async () => {
    state().acquire();
    await flush();
    const before = state().snapshot;
    checkCliProfileMock.mockRejectedValue(tagged("commandResolutionFailed"));

    await expect(state().check("builtin:codex")).resolves.toBe(false);

    expect(state().snapshot).toBe(before);
    expect(state().failure).toMatchObject({
      operation: "check",
      profileId: "builtin:codex",
      retryable: true,
    });
    expect(state().checkingProfileIds.size).toBe(0);
  });
});

describe("failure clearing and reset", () => {
  // Verify the page can dismiss a failure without touching the committed snapshot.
  it("clears the current failure on request", async () => {
    getCliProfilesMock.mockRejectedValue(tagged("persistenceFailed"));
    state().acquire();
    await flush();
    expect(state().failure).not.toBeNull();

    state().clearFailure();
    expect(state().failure).toBeNull();
  });

  // Verify a reset returns every documented default so no case inherits another's state.
  it("restores the documented defaults", async () => {
    state().acquire();
    await flush();

    resetCliProfilesStore();

    expect(state()).toMatchObject({
      status: "idle",
      snapshot: null,
      failure: null,
      listenerFailed: false,
      consumerCount: 0,
      mutation: null,
    });
    expect(state().checkingProfileIds.size).toBe(0);
  });

  // Verify a shell catalog entry helper keeps fixtures aligned with the generated contract.
  it("builds catalog fixtures from the generated shell shape", () => {
    const shell = createCliShellDto({ id: "cmd", displayName: "Command Prompt" });

    expect(shell).toMatchObject({ id: "cmd", displayName: "Command Prompt" });
    expect(typeof shell.isAvailable).toBe("boolean");
  });
});
