import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CliProfileDto,
  CliProfileInputDto,
  CliProfilesChangedDto,
  CliProfilesError,
  CliProfilesSnapshotDto,
} from "@/bindings/terminal/cli-profiles";
import {
  checkCliProfile,
  createCliProfile,
  deleteCliProfile,
  getCliProfiles,
  onCliProfilesChanged,
  setDefaultCliShell,
  updateCliProfile,
} from "./cli-profiles";
import { IpcCallError } from "./ipc-error";

// Replace the desktop boundary so no adapter case reaches the real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

/** Minimal snapshot used wherever the exact catalog contents do not matter. */
const SNAPSHOT: CliProfilesSnapshotDto = {
  revision: "7",
  defaultShellId: "system",
  effectiveDefaultShellId: "pwsh",
  shells: [],
  profiles: [],
};

/** One profile result, used by the check command which returns a single profile. */
const PROFILE: CliProfileDto = {
  id: "builtin:codex",
  name: "Codex",
  kind: "builtIn",
  command: "codex",
  arguments: [],
  shellId: null,
  effectiveShellId: "pwsh",
  icon: "Cx",
  color: "#10a37f",
  environment: [],
  availability: { status: "available", checkedAtUnixMs: "1700000000000" },
};

/** One create/update payload whose argument boundaries must survive the boundary verbatim. */
const INPUT: CliProfileInputDto = {
  name: "Gemini CLI",
  command: "gemini",
  arguments: ["--flag with space", "", '"quoted"'],
  icon: "Ge",
  color: "#5db8a6",
  environment: [{ name: "GEMINI_MODE", value: "fast", isSecret: false }],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CLI profile command wrappers", () => {
  // Verify the read command uses its exact name and sends no argument object at all.
  it("calls get_cli_profiles without arguments", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await expect(getCliProfiles()).resolves.toBe(SNAPSHOT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("get_cli_profiles", undefined);
  });

  // Verify create wraps the whole configuration in the single `input` field the backend declares.
  it("calls create_cli_profile with an input payload", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await expect(createCliProfile(INPUT)).resolves.toBe(SNAPSHOT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("create_cli_profile", { input: INPUT });
  });

  // Verify update sends the identifier and the configuration as two separate camelCase fields.
  it("calls update_cli_profile with a profile id and an input payload", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await expect(updateCliProfile("p1", INPUT)).resolves.toBe(SNAPSHOT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("update_cli_profile", {
      profileId: "p1",
      input: INPUT,
    });
  });

  // Verify the adapter forwards each argument as its own array element, never a joined string.
  it("forwards literal arguments without joining, trimming or splitting them", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await createCliProfile(INPUT);

    const [, args] = invokeMock.mock.calls[0] ?? [];
    expect((args as { input: CliProfileInputDto }).input.arguments).toEqual([
      "--flag with space",
      "",
      '"quoted"',
    ]);
  });

  // Verify delete sends only the identifier, under the camelCase name Tauri maps to `profile_id`.
  it("calls delete_cli_profile with a profile id", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await expect(deleteCliProfile("p1")).resolves.toBe(SNAPSHOT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("delete_cli_profile", { profileId: "p1" });
  });

  // Verify the default-shell command sends the stable shell id as camelCase `shellId`.
  it("calls set_default_cli_shell with a shell id", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);

    await expect(setDefaultCliShell("pwsh")).resolves.toBe(SNAPSHOT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("set_default_cli_shell", {
      shellId: "pwsh",
    });
  });

  // Verify the check command returns the single generated profile DTO unchanged.
  it("calls check_cli_profile with a profile id and returns one profile", async () => {
    invokeMock.mockResolvedValue(PROFILE);

    await expect(checkCliProfile("builtin:codex")).resolves.toBe(PROFILE);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("check_cli_profile", {
      profileId: "builtin:codex",
    });
  });
});

describe("CLI profile error normalization", () => {
  // Verify every generated code-only error survives for feature-level classification.
  it.each<CliProfilesError["code"]>([
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
  ])("preserves the tagged %s error", async (code) => {
    invokeMock.mockRejectedValue({ code });

    await expect(getCliProfiles()).rejects.toMatchObject({
      command: "get_cli_profiles",
      payload: { code },
    });
  });

  // Verify a rejection that is not shaped like `{ code }` can never be mistaken for one.
  it.each([
    ["a string rejection", "denied"],
    ["a null rejection", null],
    ["an object without a code", { message: "boom" }],
    ["an object whose code is not a string", { code: 42 }],
  ])("normalizes %s to a null payload", async (_label, rejection) => {
    invokeMock.mockRejectedValue(rejection);

    const error = await createCliProfile(INPUT).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<CliProfilesError>).payload).toBeNull();
    expect((error as IpcCallError<CliProfilesError>).command).toBe("create_cli_profile");
  });

  // Verify every command name reaches the shared error boundary, so no wrapper hides its source.
  it.each([
    ["update_cli_profile", () => updateCliProfile("p1", INPUT)],
    ["delete_cli_profile", () => deleteCliProfile("p1")],
    ["set_default_cli_shell", () => setDefaultCliShell("pwsh")],
    ["check_cli_profile", () => checkCliProfile("p1")],
  ])("names %s on its rejection", async (command, call) => {
    invokeMock.mockRejectedValue({ code: "persistenceFailed" });

    await expect(call()).rejects.toMatchObject({ command, payload: { code: "persistenceFailed" } });
  });
});

describe("CLI profile invalidation event", () => {
  // Verify the subscription uses the exact event name and hands the caller only the payload.
  it("subscribes to cli-profiles://changed and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const payload: CliProfilesChangedDto = {
      revision: "8",
      kind: "availabilityChanged",
      profileId: "builtin:codex",
    };

    const returned = await onCliProfilesChanged(handler);

    expect(listenMock.mock.calls[0]?.[0]).toBe("cli-profiles://changed");
    expect(returned).toBe(unlisten);

    const forward = listenMock.mock.calls[0]?.[1] as (event: {
      payload: CliProfilesChangedDto;
    }) => void;
    forward({ payload });

    expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
  });

  // Verify a refused registration reaches the caller instead of being swallowed by the adapter.
  it("propagates a failed listener registration", async () => {
    listenMock.mockRejectedValue(new Error("registration refused"));

    await expect(onCliProfilesChanged(vi.fn())).rejects.toThrow("registration refused");
  });
});
