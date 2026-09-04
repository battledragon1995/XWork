import { describe, expect, it } from "vitest";
import type { CloseImpactDto, CloseTargetDto, SessionsError } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  buildDeleteSessionFacts,
  classifySessionsFailure,
  SESSION_NAME_REQUIREMENT,
  SESSIONS_INTEGRATION_MESSAGE,
  validateSessionName,
} from "./session-copy";

/** The only close target FE-006 builds. */
const TARGET: CloseTargetDto = { kind: "session", sessionId: "s1" };

/** Build one impact whose blocker counts and labels a case overrides. */
function impact(overrides: Partial<CloseImpactDto> = {}): CloseImpactDto {
  return {
    target: TARGET,
    requiresConfirmation: true,
    runningProcessCount: 0,
    runningProcessLabels: [],
    unsavedFileCount: 0,
    unsavedFileLabels: [],
    ...overrides,
  };
}

/** Wrap one tagged backend error the way the adapter hands it to a feature. */
function rejection(payload: SessionsError): IpcCallError<SessionsError> {
  return new IpcCallError<SessionsError>("close_runtime_target", payload);
}

describe("classifySessionsFailure", () => {
  // Verify every code that means the target is gone lands in the one kind whose callers
  // navigate or drop a row instead of offering a retry.
  it.each<SessionsError["code"]>([
    "projectNotFound",
    "profileNotFound",
    "sessionNotFound",
    "tabNotFound",
    "paneNotFound",
    "splitNotFound",
    "noClosedTab",
  ])("classifies %s as missing", (code) => {
    const failure = classifySessionsFailure(
      rejection({ code, projectId: "p1", profileId: "x", sessionId: "s1" } as SessionsError),
    );

    expect(failure.kind).toBe("missing");
    expect(failure.code).toBe(code);
    expect(failure.canRetry).toBe(false);
  });

  // Verify the name rule is reported verbatim, because the dialog shows it unchanged.
  it("classifies invalidName with the exact name requirement", () => {
    const failure = classifySessionsFailure(rejection({ code: "invalidName" }));

    expect(failure).toEqual({
      kind: "invalidName",
      code: "invalidName",
      message: SESSION_NAME_REQUIREMENT,
      canRetry: false,
    });
  });

  // Verify every code that means "wait, do not retry now" lands in the busy kind.
  it.each<SessionsError["code"]>([
    "projectUnavailable",
    "profileUnavailable",
    "sessionNotEmpty",
    "paneNotEmpty",
    "closeInProgress",
    "runtimeShuttingDown",
  ])("classifies %s as busy", (code) => {
    const failure = classifySessionsFailure(
      rejection({ code, projectId: "p1", profileId: "x", sessionId: "s1" } as SessionsError),
    );

    expect(failure.kind).toBe("busy");
    expect(failure.canRetry).toBe(false);
  });

  // Verify a repeated confirmation is a busy outcome the dialog handles itself rather than
  // an error it should present as a failed delete.
  it("classifies confirmationRequired as busy", () => {
    const failure = classifySessionsFailure(
      rejection({ code: "confirmationRequired", impact: impact() }),
    );

    expect(failure.kind).toBe("busy");
    expect(failure.code).toBe("confirmationRequired");
  });

  // Verify a boundary problem is reported as unrecoverable, so no surface loops on it.
  it.each<SessionsError["code"]>(["unauthorizedWindow"])(
    "classifies %s as an integration failure",
    (code) => {
      const failure = classifySessionsFailure(rejection({ code } as SessionsError));

      expect(failure.kind).toBe("integration");
      expect(failure.message).toBe(SESSIONS_INTEGRATION_MESSAGE);
      expect(failure.canRetry).toBe(false);
    },
  );

  // Verify workspace rule failures use their operation-specific FE-007 copy.
  it.each([
    ["invalidMove", "XWork couldn't move that tab."],
    ["invalidSplitRatio", "XWork couldn't resize that split."],
    ["paneLimitReached", "A tab can hold up to 4 panes."],
  ] as const)("classifies %s with workspace copy", (code, message) => {
    const failure = classifySessionsFailure(rejection({ code } as SessionsError));

    expect(failure.message).toBe(message);
    expect(failure.canRetry).toBe(false);
  });

  // Verify the three transient backend failures are the only ones marked retryable.
  it.each<SessionsError["code"]>([
    "projectLookupFailed",
    "profileLookupFailed",
    "contentLifecycleFailed",
  ])("classifies %s as retryable", (code) => {
    const failure = classifySessionsFailure(
      rejection({ code, operation: "close", targetId: "s1" } as SessionsError),
    );

    expect(failure.kind).toBe("unknown");
    expect(failure.canRetry).toBe(true);
  });

  // Verify an unrecognized rejection is never coerced into a known code.
  it.each([
    ["a plain error", new Error("boom")],
    ["a string", "denied"],
    ["a null payload", new IpcCallError<SessionsError>("get_session", null)],
  ])("classifies %s as unknown without a code", (_label, thrown) => {
    const failure = classifySessionsFailure(thrown);

    expect(failure).toEqual({
      kind: "unknown",
      code: "unknown",
      message: SESSIONS_INTEGRATION_MESSAGE,
      canRetry: false,
    });
  });
});

describe("validateSessionName", () => {
  // Verify surrounding whitespace never reaches the backend.
  it("trims the value it reports as valid", () => {
    expect(validateSessionName("  Debounce PTY resize  ")).toEqual({
      isValid: true,
      value: "Debounce PTY resize",
    });
  });

  // Verify a whitespace-only name is rejected before any command is called.
  it.each([
    ["an empty string", ""],
    ["only spaces", "   "],
    ["only a tab", "\t"],
  ])("rejects %s", (_label, raw) => {
    expect(validateSessionName(raw).isValid).toBe(false);
  });

  // Verify a control character is rejected even when the rest of the name is fine.
  it("rejects a control character inside the name", () => {
    expect(validateSessionName("Debounce\u0007resize").isValid).toBe(false);
  });

  // Verify the length boundary is measured in Unicode scalar values, so an astral emoji
  // counts once instead of twice as `String.length` would report it.
  it("accepts exactly 80 scalar values", () => {
    const name = "😀".repeat(80);

    expect(name.length).toBe(160);
    expect(validateSessionName(name)).toEqual({ isValid: true, value: name });
  });

  // Verify one scalar value past the limit is rejected.
  it("rejects 81 scalar values", () => {
    expect(validateSessionName("😀".repeat(81)).isValid).toBe(false);
  });

  // Verify a single character is enough.
  it("accepts one scalar value", () => {
    expect(validateSessionName("x")).toEqual({ isValid: true, value: "x" });
  });
});

describe("buildDeleteSessionFacts", () => {
  // Verify an impact with no blockers produces no fact rows at all, so the box is absent.
  it("returns no facts for an empty impact", () => {
    expect(buildDeleteSessionFacts(impact())).toEqual([]);
  });

  // Verify one running process reads in the singular and names its label.
  it("states one running process in the singular", () => {
    expect(
      buildDeleteSessionFacts(impact({ runningProcessCount: 1, runningProcessLabels: ["claude"] })),
    ).toEqual(["1 running process will be stopped: claude"]);
  });

  // Verify several running processes read in the plural with every label listed.
  it("states several running processes in the plural", () => {
    expect(
      buildDeleteSessionFacts(
        impact({ runningProcessCount: 2, runningProcessLabels: ["claude", "pnpm test"] }),
      ),
    ).toEqual(["2 running processes will be stopped: claude, pnpm test"]);
  });

  // Verify one unsaved file reads in the singular.
  it("states one unsaved file in the singular", () => {
    expect(
      buildDeleteSessionFacts(impact({ unsavedFileCount: 1, unsavedFileLabels: ["README.md"] })),
    ).toEqual(["1 file with unsaved changes: README.md"]);
  });

  // Verify both families appear in the documented order when both are present.
  it("lists processes before unsaved files", () => {
    expect(
      buildDeleteSessionFacts(
        impact({
          runningProcessCount: 1,
          runningProcessLabels: ["claude"],
          unsavedFileCount: 2,
          unsavedFileLabels: ["README.md", "notes.md"],
        }),
      ),
    ).toEqual([
      "1 running process will be stopped: claude",
      "2 files with unsaved changes: README.md, notes.md",
    ]);
  });

  // Verify exactly five labels are still listed in full, which is the documented cap.
  it("lists five labels without a summary suffix", () => {
    const labels = ["a", "b", "c", "d", "e"];

    expect(
      buildDeleteSessionFacts(impact({ runningProcessCount: 5, runningProcessLabels: labels })),
    ).toEqual(["5 running processes will be stopped: a, b, c, d, e"]);
  });

  // Verify a sixth label is folded into `+{n} more` while the count stays authoritative.
  it("caps the label list at five and reports the remainder", () => {
    const labels = ["a", "b", "c", "d", "e", "f", "g"];

    expect(
      buildDeleteSessionFacts(impact({ runningProcessCount: 7, runningProcessLabels: labels })),
    ).toEqual(["7 running processes will be stopped: a, b, c, d, e, +2 more"]);
  });

  // Verify the count always comes from the backend even when it disagrees with the labels,
  // because only the count is authoritative about what will actually be stopped.
  it("keeps the backend count when fewer labels were supplied", () => {
    expect(
      buildDeleteSessionFacts(impact({ runningProcessCount: 9, runningProcessLabels: ["claude"] })),
    ).toEqual(["9 running processes will be stopped: claude, +8 more"]);
  });

  // Verify a counted blocker with no label at all still states the fact.
  it("states a counted blocker that carries no label", () => {
    expect(buildDeleteSessionFacts(impact({ unsavedFileCount: 3 }))).toEqual([
      "3 files with unsaved changes.",
    ]);
  });

  // Verify a label array with a zero count produces nothing, since the count decides.
  it("renders no row for a zero count that still carries labels", () => {
    expect(
      buildDeleteSessionFacts(impact({ runningProcessCount: 0, runningProcessLabels: ["stale"] })),
    ).toEqual([]);
  });
});
