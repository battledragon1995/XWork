import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfileDto, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import * as cliProfilesIpc from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { useToolCatalog } from "./use-tool-catalog";

// Replace the whole CLI profile boundary so no case reaches Tauri or a real listener.
vi.mock("@/lib/ipc/cli-profiles", () => ({
  checkCliProfile: vi.fn(),
  getCliProfiles: vi.fn(),
  onCliProfilesChanged: vi.fn(),
}));

const getCliProfilesMock = vi.mocked(cliProfilesIpc.getCliProfiles);
const checkCliProfileMock = vi.mocked(cliProfilesIpc.checkCliProfile);
const onCliProfilesChangedMock = vi.mocked(cliProfilesIpc.onCliProfilesChanged);

/** Build one profile with the generated shape and an available default. */
function profile(overrides: Partial<CliProfileDto> = {}): CliProfileDto {
  return {
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
    ...overrides,
  };
}

/** Build one whole catalog snapshot. */
function snapshot(overrides: Partial<CliProfilesSnapshotDto> = {}): CliProfilesSnapshotDto {
  return {
    revision: "1",
    defaultShellId: "system",
    effectiveDefaultShellId: "pwsh",
    shells: [],
    profiles: [profile()],
    ...overrides,
  };
}

/** Build one promise a case settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Deliver one catalog invalidation exactly as the adapter would. */
function emit(): void {
  const handler = onCliProfilesChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The hook should have registered a catalog handler.");
  }
  act(() => handler({ revision: "2", kind: "availabilityChanged", profileId: null }));
}

/** Mount the hook and wait for its first read to settle. */
async function mountReady() {
  const view = renderHook(() => useToolCatalog());
  await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCliProfilesMock.mockResolvedValue(snapshot());
  checkCliProfileMock.mockResolvedValue(profile());
  onCliProfilesChangedMock.mockResolvedValue(() => {});
});

afterEach(() => {
  cleanup();
});

describe("useToolCatalog reads", () => {
  // Verify the picker reads the whole catalog once with no arguments.
  it("reads the catalog once", async () => {
    const view = await mountReady();

    expect(getCliProfilesMock).toHaveBeenCalledExactlyOnceWith();
    expect(view.result.current.snapshot?.profiles).toHaveLength(1);
  });

  // Verify the first read is a loading phase with no snapshot at all.
  it("starts in the loading phase", () => {
    const pending = deferred<CliProfilesSnapshotDto>();
    getCliProfilesMock.mockReturnValue(pending.promise);

    const view = renderHook(() => useToolCatalog());

    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.snapshot).toBeNull();

    pending.resolve(snapshot());
  });

  // Verify a failed first read is a catalog error with one more attempt.
  it("reports a failed first read", async () => {
    getCliProfilesMock.mockRejectedValue(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );

    const view = renderHook(() => useToolCatalog());

    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.failure).toMatchObject({
      operation: "load",
      message: "XWork couldn't load your CLI profiles.",
      canRetry: true,
    });
  });

  // Verify the retry reads the catalog again and clears the failure.
  it("recovers on a retry", async () => {
    getCliProfilesMock.mockRejectedValueOnce(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );
    const view = renderHook(() => useToolCatalog());
    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));

    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.failure).toBeNull();
  });

  // Verify a later failure keeps the grid on screen instead of replacing it with an error.
  it("keeps its snapshot when a later read fails", async () => {
    const view = await mountReady();

    getCliProfilesMock.mockRejectedValue(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );
    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.failure).not.toBeNull());
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.snapshot).not.toBeNull();
  });

  // Verify an invalidation event reads a whole snapshot rather than patching state from a
  // payload that carries no configuration at all.
  it("reads a whole snapshot after an invalidation", async () => {
    const view = await mountReady();
    getCliProfilesMock.mockResolvedValue(
      snapshot({ revision: "2", profiles: [profile({ name: "Codex CLI" })] }),
    );

    emit();

    await vi.waitFor(() => expect(getCliProfilesMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(view.result.current.snapshot?.profiles[0]?.name).toBe("Codex CLI"),
    );
  });

  // Verify a read that lost its race cannot roll the catalog back.
  it("drops a stale read in favour of the newer one", async () => {
    const slow = deferred<CliProfilesSnapshotDto>();
    getCliProfilesMock.mockReturnValueOnce(slow.promise);
    const view = renderHook(() => useToolCatalog());

    getCliProfilesMock.mockResolvedValue(
      snapshot({ revision: "5", profiles: [profile({ name: "Newer" })] }),
    );
    act(() => view.result.current.refresh());
    await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));

    await act(async () => {
      slow.resolve(snapshot({ revision: "1", profiles: [profile({ name: "Older" })] }));
      await slow.promise;
    });

    expect(view.result.current.snapshot?.profiles[0]?.name).toBe("Newer");
  });

  // Verify a refused registration is silent and leaves the catalog readable.
  it("keeps reading data when the registration is refused", async () => {
    onCliProfilesChangedMock.mockRejectedValue(new Error("registration refused"));

    const view = await mountReady();

    expect(view.result.current.failure).toBeNull();
    expect(view.result.current.snapshot).not.toBeNull();
  });

  // Verify unmounting removes the listener.
  it("releases its listener on unmount", async () => {
    const unlisten = vi.fn<() => void>();
    onCliProfilesChangedMock.mockResolvedValue(unlisten);
    const view = await mountReady();

    view.unmount();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  // Verify a registration finishing after unmount disposes itself instead of surviving.
  it("disposes a listener that resolves after unmount", async () => {
    const unlisten = vi.fn<() => void>();
    const registration = deferred<() => void>();
    onCliProfilesChangedMock.mockReturnValue(registration.promise as never);
    const view = renderHook(() => useToolCatalog());

    view.unmount();
    registration.resolve(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });
});

describe("useToolCatalog checks", () => {
  // Verify a check marks only its own profile and reads a fresh snapshot afterwards, because
  // the command's own result carries no revision.
  it("checks one profile and reads a fresh snapshot", async () => {
    const view = await mountReady();

    await act(async () => {
      await view.result.current.check("builtin:codex");
    });

    expect(checkCliProfileMock).toHaveBeenCalledExactlyOnceWith("builtin:codex");
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.checkingProfileIds.size).toBe(0);
  });

  // Verify the in-flight marker is published for exactly the profile being checked.
  it("publishes the profile it is checking", async () => {
    const pending = deferred<CliProfileDto>();
    checkCliProfileMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    act(() => {
      void view.result.current.check("builtin:codex");
    });

    await vi.waitFor(() =>
      expect(view.result.current.checkingProfileIds.has("builtin:codex")).toBe(true),
    );
    expect(view.result.current.checkingProfileIds.has("builtin:claude")).toBe(false);

    await act(async () => {
      pending.resolve(profile());
      await pending.promise;
    });
  });

  // Verify a second press on the same card sends no second command.
  it("suppresses a duplicate check of the same profile", async () => {
    const pending = deferred<CliProfileDto>();
    checkCliProfileMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    await act(async () => {
      void view.result.current.check("builtin:codex");
      await view.result.current.check("builtin:codex");
    });

    expect(checkCliProfileMock).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(profile());
      await pending.promise;
    });
  });

  // Verify two different profiles can be checked at the same time, so one slow card never
  // blocks another.
  it("checks two profiles independently", async () => {
    const pending = deferred<CliProfileDto>();
    checkCliProfileMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    await act(async () => {
      void view.result.current.check("builtin:codex");
      void view.result.current.check("builtin:claude");
      await Promise.resolve();
    });

    expect(checkCliProfileMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.checkingProfileIds.size).toBe(2);

    await act(async () => {
      pending.resolve(profile());
      await pending.promise;
    });
  });

  // Verify a profile that disappeared reads the catalog again with its own exact copy.
  it("reloads the catalog for a profile that no longer exists", async () => {
    checkCliProfileMock.mockRejectedValue(
      new IpcCallError("check_cli_profile", { code: "profileNotFound" }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.check("builtin:codex");
    });

    expect(view.result.current.failure).toMatchObject({
      operation: "check",
      code: "profileNotFound",
      message: "That tool no longer exists.",
      canRetry: false,
    });
    expect(getCliProfilesMock).toHaveBeenCalledTimes(2);
  });

  // Verify every other check failure keeps the card and states the generic reason.
  it.each([
    ["commandResolutionFailed", { code: "commandResolutionFailed" }],
    ["an unrecognized rejection", { message: "boom" }],
  ])("keeps the card after %s", async (_label, payload) => {
    checkCliProfileMock.mockRejectedValue(new IpcCallError("check_cli_profile", payload as never));
    const view = await mountReady();

    await act(async () => {
      await view.result.current.check("builtin:codex");
    });

    expect(view.result.current.failure).toMatchObject({
      operation: "check",
      profileId: "builtin:codex",
      message: "XWork couldn't check that tool.",
    });
    expect(view.result.current.snapshot).not.toBeNull();
  });

  // Verify a check that answers after unmounting publishes nothing at all.
  it("publishes nothing after unmounting", async () => {
    const pending = deferred<CliProfileDto>();
    checkCliProfileMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    act(() => {
      void view.result.current.check("builtin:codex");
    });
    view.unmount();

    await act(async () => {
      pending.resolve(profile());
      await pending.promise;
    });

    // Only the mount's own read happened; the check's follow-up read was abandoned.
    expect(getCliProfilesMock).toHaveBeenCalledOnce();
  });
});

describe("useToolCatalog temporary unavailability", () => {
  // Verify a refused selection can mark a card at once, before any snapshot catches up.
  it("marks a profile unavailable immediately", async () => {
    const view = await mountReady();

    act(() => view.result.current.markUnavailable("builtin:codex"));

    expect(view.result.current.unavailableProfileIds.has("builtin:codex")).toBe(true);
  });

  // Verify the marker lasts only until the next accepted snapshot, which is the authority on
  // availability and may well report the profile as available again.
  it("drops the marker on the next accepted snapshot", async () => {
    const view = await mountReady();
    act(() => view.result.current.markUnavailable("builtin:codex"));

    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.unavailableProfileIds.size).toBe(0));
  });

  // Verify a failed read leaves the marker in place, since nothing newer was learned.
  it("keeps the marker when a read fails", async () => {
    const view = await mountReady();
    act(() => view.result.current.markUnavailable("builtin:codex"));

    getCliProfilesMock.mockRejectedValue(
      new IpcCallError("get_cli_profiles", { code: "persistenceFailed" }),
    );
    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.failure).not.toBeNull());
    expect(view.result.current.unavailableProfileIds.has("builtin:codex")).toBe(true);
  });
});
