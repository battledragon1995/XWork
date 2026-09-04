import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRuntimeEventDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import {
  readSessionCrumb,
  readSessionProjectId,
  resetSessionsStore,
  useSessionsStore,
} from "./sessions-store";
import {
  createRuntimeEvent,
  createSessionSummary,
  FIXTURE_OTHER_PROJECT_ID,
  FIXTURE_PROJECT_ID,
} from "./sessions-test-fixture";

// Replace the whole Sessions boundary so no case reaches Tauri or registers a real listener.
vi.mock("@/lib/ipc/sessions", () => ({
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
}));

const listSessionsMock = vi.mocked(sessionsIpc.listSessions);
const onRuntimeChangedMock = vi.mocked(sessionsIpc.onSessionsRuntimeChanged);

/** Build one promise a case settles by hand, so a race can be observed deterministically. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

/** Deliver one event to the store exactly as the adapter would, with no real subscription. */
function emit(event: SessionRuntimeEventDto): void {
  const handler = onRuntimeChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The store should have registered a runtime-changed handler.");
  }
  handler(event);
}

/** Two sessions of the fixture project plus one of another, in the order the backend returns. */
const ALPHA_ONE = createSessionSummary({ id: "s1", name: "Debounce PTY resize" });
const ALPHA_TWO = createSessionSummary({ id: "s2", name: "Docs review", status: "running" });
const BETA_ONE = createSessionSummary({
  id: "s3",
  projectId: FIXTURE_OTHER_PROJECT_ID,
  name: "Beta work",
});

/** Unlisten spy of the most recent successful registration. */
let unlisten: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionsStore();
  unlisten = vi.fn<() => void>();
  listSessionsMock.mockResolvedValue([]);
  onRuntimeChangedMock.mockResolvedValue(unlisten);
});

afterEach(() => {
  resetSessionsStore();
});

describe("sessions store lifecycle", () => {
  // Verify the first consumer starts exactly one query and one subscription.
  it("loads once for the first consumer", async () => {
    const pending = deferred<SessionSummaryDto[]>();
    listSessionsMock.mockReturnValue(pending.promise);

    useSessionsStore.getState().acquire();

    expect(useSessionsStore.getState().status).toBe("loading");
    expect(listSessionsMock).toHaveBeenCalledExactlyOnceWith();
    expect(onRuntimeChangedMock).toHaveBeenCalledOnce();

    pending.resolve([]);
    await pending.promise;
  });

  // Verify a second consumer reuses the running session instead of duplicating resources.
  it("reuses the query and the listener for a second consumer", async () => {
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    useSessionsStore.getState().acquire();

    expect(useSessionsStore.getState().consumerCount).toBe(2);
    expect(listSessionsMock).toHaveBeenCalledOnce();
    expect(onRuntimeChangedMock).toHaveBeenCalledOnce();
  });

  // Verify only the final release removes the event listener and the focus listener.
  it("releases its listeners with the last consumer", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    useSessionsStore.getState().acquire();
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(onRuntimeChangedMock).toHaveBeenCalledOnce());
    await Promise.resolve();

    useSessionsStore.getState().release();
    expect(unlisten).not.toHaveBeenCalled();

    useSessionsStore.getState().release();

    expect(useSessionsStore.getState().consumerCount).toBe(0);
    expect(unlisten).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    removeSpy.mockRestore();
  });

  // Verify a registration that finishes after the final release disposes itself, so no
  // orphaned callback survives to write into a released store.
  it("disposes a listener that resolves after the last release", async () => {
    const registration = deferred<() => void>();
    onRuntimeChangedMock.mockReturnValue(registration.promise as never);

    useSessionsStore.getState().acquire();
    useSessionsStore.getState().release();

    registration.resolve(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });

  // Verify a refused registration is silent: the snapshot still loads and no error is shown.
  it("keeps loading data when the registration is refused", async () => {
    onRuntimeChangedMock.mockRejectedValue(new Error("registration refused"));
    listSessionsMock.mockResolvedValue([ALPHA_ONE]);

    useSessionsStore.getState().acquire();

    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));
    expect(useSessionsStore.getState().failure).toBeNull();
  });

  // Verify returning to the foreground re-reads the list, which is the only signal available
  // for a change made while the window was in the background.
  it("re-reads the list when the window regains focus", async () => {
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
  });
});

describe("sessions store grouping", () => {
  // Verify sessions are grouped by project while each group keeps the backend's own order.
  it("groups summaries by project in backend order", async () => {
    listSessionsMock.mockResolvedValue([ALPHA_TWO, BETA_ONE, ALPHA_ONE]);

    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    const groups = useSessionsStore.getState().sessionsByProject;
    expect(groups[FIXTURE_PROJECT_ID]?.map((session) => session.id)).toEqual(["s2", "s1"]);
    expect(groups[FIXTURE_OTHER_PROJECT_ID]?.map((session) => session.id)).toEqual(["s3"]);
  });

  // Verify a failed first read reports an error without inventing an empty snapshot.
  it("reports a failed first read", async () => {
    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );

    useSessionsStore.getState().acquire();

    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("error"));
    expect(useSessionsStore.getState().failure?.canRetry).toBe(true);
    expect(useSessionsStore.getState().sessionsByProject).toEqual({});
  });

  // Verify a later failed read keeps the previous snapshot visible rather than blanking it.
  it("retains the previous snapshot when a refresh fails", async () => {
    listSessionsMock.mockResolvedValue([ALPHA_ONE]);
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );
    useSessionsStore.getState().refresh();

    await vi.waitFor(() => expect(useSessionsStore.getState().failure).not.toBeNull());
    expect(useSessionsStore.getState().status).toBe("ready");
    expect(useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]).toHaveLength(1);
  });

  // Verify a response that lost its race is dropped, so a slow read cannot roll the list back.
  it("drops a stale read in favour of the newer one", async () => {
    const slow = deferred<SessionSummaryDto[]>();
    listSessionsMock.mockReturnValueOnce(slow.promise);
    useSessionsStore.getState().acquire();

    listSessionsMock.mockResolvedValue([ALPHA_TWO]);
    useSessionsStore.getState().refresh();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    slow.resolve([ALPHA_ONE, BETA_ONE]);
    await slow.promise;

    expect(
      useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]?.map((s) => s.id),
    ).toEqual(["s2"]);
    expect(useSessionsStore.getState().sessionsByProject[FIXTURE_OTHER_PROJECT_ID]).toBeUndefined();
  });

  // Verify a committed event applied while a read was in flight survives that read, because
  // the event describes a later state than the snapshot the backend had already built.
  it("keeps an event applied while a read was in flight", async () => {
    const slow = deferred<SessionSummaryDto[]>();
    listSessionsMock.mockReturnValue(slow.promise);
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(onRuntimeChangedMock).toHaveBeenCalledOnce());

    emit(createRuntimeEvent({ revision: "5", change: "created", summary: ALPHA_TWO }));
    slow.resolve([ALPHA_ONE]);
    await slow.promise;

    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));
    expect(
      useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]?.map((s) => s.id),
    ).toEqual(["s2"]);
  });
});

describe("sessions store event application", () => {
  // Load one baseline snapshot and subscribe, which every event case starts from.
  async function withBaseline(summaries: SessionSummaryDto[] = [ALPHA_ONE]): Promise<void> {
    listSessionsMock.mockResolvedValue(summaries);
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));
    await vi.waitFor(() => expect(onRuntimeChangedMock).toHaveBeenCalledOnce());
    await Promise.resolve();
  }

  // Verify a created session is appended to its own project group.
  it("adds a created session to its project group", async () => {
    await withBaseline();

    emit(createRuntimeEvent({ revision: "4", change: "created", summary: ALPHA_TWO }));

    expect(
      useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]?.map((s) => s.id),
    ).toEqual(["s1", "s2"]);
    expect(useSessionsStore.getState().appliedRevision).toBe("4");
  });

  // Verify a created session for another project starts that project's own group.
  it("starts a new group for another project", async () => {
    await withBaseline();

    emit(createRuntimeEvent({ revision: "4", change: "created", summary: BETA_ONE }));

    expect(
      useSessionsStore.getState().sessionsByProject[FIXTURE_OTHER_PROJECT_ID]?.map((s) => s.id),
    ).toEqual(["s3"]);
  });

  // Verify an updated summary replaces the existing one in place, keeping its position.
  it.each<"updated" | "activityChanged">(["updated", "activityChanged"])(
    "replaces a summary in place on %s",
    async (change) => {
      await withBaseline([ALPHA_ONE, ALPHA_TWO]);

      emit(
        createRuntimeEvent({
          revision: "4",
          change,
          summary: { ...ALPHA_ONE, name: "Renamed", status: "needsAttention" },
        }),
      );

      const group = useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID] ?? [];
      expect(group.map((s) => s.id)).toEqual(["s1", "s2"]);
      expect(group[0]?.name).toBe("Renamed");
      expect(group[0]?.status).toBe("needsAttention");
    },
  );

  // Verify a deleted session is removed and its now-empty group disappears entirely.
  it("removes a deleted session and drops an emptied group", async () => {
    await withBaseline([ALPHA_ONE]);

    emit(
      createRuntimeEvent({
        revision: "4",
        change: "deleted",
        projectId: FIXTURE_PROJECT_ID,
        sessionId: "s1",
        summary: null,
      }),
    );

    expect(useSessionsStore.getState().sessionsByProject).toEqual({});
  });

  // Verify an event at or below the applied revision is ignored, so a duplicate delivery
  // cannot resurrect a row the store already removed.
  it("ignores an event at or below the applied revision", async () => {
    await withBaseline([ALPHA_ONE]);
    emit(createRuntimeEvent({ revision: "4", change: "created", summary: ALPHA_TWO }));

    emit(createRuntimeEvent({ revision: "4", change: "created", summary: BETA_ONE }));
    emit(createRuntimeEvent({ revision: "3", change: "created", summary: BETA_ONE }));

    expect(useSessionsStore.getState().sessionsByProject[FIXTURE_OTHER_PROJECT_ID]).toBeUndefined();
    expect(useSessionsStore.getState().appliedRevision).toBe("4");
  });

  // Verify revisions are ordered as integers rather than as strings, so `10` is newer than
  // `9` even though its first character sorts lower.
  it("orders multi-digit revisions numerically", async () => {
    await withBaseline([ALPHA_ONE]);
    emit(createRuntimeEvent({ revision: "9", change: "created", summary: ALPHA_TWO }));

    emit(createRuntimeEvent({ revision: "10", change: "deleted", sessionId: "s2", summary: null }));

    expect(
      useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]?.map((s) => s.id),
    ).toEqual(["s1"]);
    expect(useSessionsStore.getState().appliedRevision).toBe("10");
  });

  // Verify a revision beyond the next one triggers a whole new read instead of a patch, so a
  // dropped event cannot leave the list stuck on an inconsistent snapshot.
  it("re-reads the list after a revision gap", async () => {
    await withBaseline([ALPHA_ONE]);
    emit(createRuntimeEvent({ revision: "4", change: "created", summary: ALPHA_TWO }));
    listSessionsMock.mockResolvedValue([ALPHA_ONE, BETA_ONE]);

    emit(createRuntimeEvent({ revision: "7", change: "created", summary: BETA_ONE }));

    await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        useSessionsStore.getState().sessionsByProject[FIXTURE_OTHER_PROJECT_ID]?.map((s) => s.id),
      ).toEqual(["s3"]),
    );
    // A refreshed snapshot carries no revision, so gap detection restarts from the next event.
    expect(useSessionsStore.getState().appliedRevision).toBeNull();
  });

  // Verify the very first event after a read is accepted whatever its revision, because a
  // snapshot carries none and cannot be compared against.
  it("accepts the first event after a read as its baseline", async () => {
    await withBaseline([ALPHA_ONE]);

    emit(createRuntimeEvent({ revision: "9001", change: "created", summary: ALPHA_TWO }));

    expect(useSessionsStore.getState().appliedRevision).toBe("9001");
    expect(useSessionsStore.getState().sessionsByProject[FIXTURE_PROJECT_ID]).toHaveLength(2);
  });
});

describe("imperative crumb reads", () => {
  // Verify the breadcrumb reader finds a session's project and name in the retained snapshot.
  it("reads the project and name of a known session", async () => {
    listSessionsMock.mockResolvedValue([ALPHA_ONE, BETA_ONE]);
    useSessionsStore.getState().acquire();
    await vi.waitFor(() => expect(useSessionsStore.getState().status).toBe("ready"));

    expect(readSessionCrumb("s1")).toEqual({
      projectId: FIXTURE_PROJECT_ID,
      name: "Debounce PTY resize",
    });
    expect(readSessionProjectId("s3")).toBe(FIXTURE_OTHER_PROJECT_ID);
  });

  // Verify an unknown or absent id reads as nothing rather than as an empty label.
  it.each([
    ["an unknown id", "missing"],
    ["no id at all", undefined],
  ])("reads null for %s", (_label, sessionId) => {
    expect(readSessionCrumb(sessionId)).toBeNull();
    expect(readSessionProjectId(sessionId)).toBeNull();
  });
});
