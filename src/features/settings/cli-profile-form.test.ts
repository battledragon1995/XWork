import { describe, expect, it } from "vitest";
import type { CliShellDto } from "@/bindings/terminal/cli-profiles";
import {
  addArgumentRow,
  addEnvironmentRow,
  beginReplaceStoredValue,
  buildCliProfileInput,
  canKeepStoredValue,
  type CliEnvironmentDraft,
  type CliProfileDraft,
  createEditProfileDraft,
  createEmptyProfileDraft,
  isCliProfileDraftDirty,
  keepStoredValue,
  MAX_ARGUMENT_ROWS,
  MAX_ENVIRONMENT_ROWS,
  moveDraftRow,
  removeDraftRow,
  setEnvironmentName,
  setEnvironmentSecret,
  validateCliProfileDraft,
} from "./cli-profile-form";
import {
  createCliShellCatalog,
  createCustomProfileDto,
  createStoredSecretDto,
  DUMMY_FE013_SECRET,
} from "./cli-profiles-test-fixture";

/** The catalog every validation case checks a shell override against. */
const SHELLS: CliShellDto[] = createCliShellCatalog();

/** Build a draft that passes every rule, so each case can break exactly one thing. */
function validDraft(overrides: Partial<CliProfileDraft> = {}): CliProfileDraft {
  return { ...createEmptyProfileDraft(), name: "Gemini CLI", command: "gemini", ...overrides };
}

/** Build one environment row with the defaults a fresh row has. */
function envRow(overrides: Partial<CliEnvironmentDraft> = {}): CliEnvironmentDraft {
  return {
    key: "env-test",
    name: "GEMINI_MODE",
    value: "fast",
    isSecret: false,
    hasStoredValue: false,
    storedName: null,
    replaceStoredValue: false,
    ...overrides,
  };
}

describe("createEmptyProfileDraft", () => {
  // Verify a new profile starts with the exact FE-013 defaults and no rows at all.
  it("uses the documented create defaults", () => {
    const draft = createEmptyProfileDraft();

    expect(draft).toMatchObject({
      mode: "create",
      profileId: null,
      name: "",
      command: "",
      shellId: null,
      icon: ">_",
      color: "#64748b",
    });
    expect(draft.arguments).toHaveLength(0);
    expect(draft.environment).toHaveLength(0);
  });

  // Verify every row key is unique so React can identify rows without using the index.
  it("hands out unique row keys", () => {
    const draft = addArgumentRow(addArgumentRow(createEmptyProfileDraft()));
    const withEnv = addEnvironmentRow(addEnvironmentRow(draft));

    const keys = [
      ...withEnv.arguments.map((row) => row.key),
      ...withEnv.environment.map((row) => row.key),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("createEditProfileDraft", () => {
  // Verify every editable field is taken from the DTO exactly as the backend stored it.
  it("maps a saved profile onto an editable draft", () => {
    const profile = createCustomProfileDto({
      arguments: ["--model o3", "", '"quoted"'],
      shellId: "pwsh",
      environment: [
        { name: "PLAIN", value: "yes", isSecret: false, hasStoredValue: false },
        createStoredSecretDto("SECRET_TOKEN"),
      ],
    });

    const draft = createEditProfileDraft(profile);

    expect(draft).toMatchObject({
      mode: "edit",
      profileId: profile.id,
      name: "Gemini CLI",
      command: "gemini",
      shellId: "pwsh",
      icon: "Ge",
      color: "#5db8a6",
    });
    expect(draft.arguments.map((row) => row.value)).toEqual(["--model o3", "", '"quoted"']);
    expect(draft.environment[0]).toMatchObject({ name: "PLAIN", value: "yes", isSecret: false });
    expect(draft.environment[1]).toMatchObject({
      name: "SECRET_TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "SECRET_TOKEN",
      replaceStoredValue: false,
    });
  });

  // Verify a profile without a command or a shell override is still fully editable.
  it("maps a null command and an inherited shell", () => {
    const draft = createEditProfileDraft(
      createCustomProfileDto({ command: null, shellId: null, arguments: [] }),
    );

    expect(draft.command).toBe("");
    expect(draft.shellId).toBeNull();
  });

  // Verify a stored secret never reaches the draft as plaintext, whatever the DTO says.
  it("never carries a stored secret value into the draft", () => {
    const draft = createEditProfileDraft(
      createCustomProfileDto({ environment: [createStoredSecretDto("SECRET_TOKEN")] }),
    );

    expect(draft.environment[0]?.value).toBe("");
  });
});

describe("isCliProfileDraftDirty", () => {
  // Verify a freshly mapped draft is clean, so opening the editor cannot block a close.
  it("reports a freshly mapped draft as clean", () => {
    const profile = createCustomProfileDto({ arguments: ["--yolo"] });

    expect(isCliProfileDraftDirty(createEditProfileDraft(profile), profile)).toBe(false);
  });

  // Verify a backend availability or effective-shell change alone never dirties the editor.
  it("ignores availability and effective shell changes", () => {
    const profile = createCustomProfileDto();
    const draft = createEditProfileDraft(profile);
    const refreshed = createCustomProfileDto({
      availability: { status: "commandNotFound", checkedAtUnixMs: "1800000000000" },
      effectiveShellId: "cmd",
    });

    expect(isCliProfileDraftDirty(draft, refreshed)).toBe(false);
  });

  // Verify each editable change is detected, including a pending secret replacement.
  it.each<[string, (draft: CliProfileDraft) => CliProfileDraft]>([
    ["name", (draft) => ({ ...draft, name: "Renamed" })],
    ["command", (draft) => ({ ...draft, command: "other" })],
    ["icon", (draft) => ({ ...draft, icon: "Gg" })],
    ["colour", (draft) => ({ ...draft, color: "#123456" })],
    ["shell", (draft) => ({ ...draft, shellId: "cmd" })],
    ["arguments", (draft) => addArgumentRow(draft)],
    ["argument order", (draft) => ({ ...draft, arguments: [...draft.arguments].reverse() })],
    ["environment", (draft) => addEnvironmentRow(draft)],
    [
      "pending secret replacement",
      (draft) => ({
        ...draft,
        environment: draft.environment.map((row) => beginReplaceStoredValue(row)),
      }),
    ],
  ])("detects a changed %s", (_label, mutate) => {
    const profile = createCustomProfileDto({
      arguments: ["--yolo", "--fast"],
      environment: [createStoredSecretDto("SECRET_TOKEN")],
    });
    const draft = createEditProfileDraft(profile);

    expect(isCliProfileDraftDirty(mutate(draft), profile)).toBe(true);
  });

  // Verify an untouched create draft is clean while any entry makes it dirty.
  it("compares a create draft against the empty defaults", () => {
    expect(isCliProfileDraftDirty(createEmptyProfileDraft(), null)).toBe(false);
    expect(isCliProfileDraftDirty({ ...createEmptyProfileDraft(), name: "x" }, null)).toBe(true);
  });
});

describe("row helpers", () => {
  // Verify moving a row changes only its position and leaves the values untouched.
  it("moves a row within its list", () => {
    const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];

    expect(moveDraftRow(rows, 2, -1).map((row) => row.key)).toEqual(["a", "c", "b"]);
    expect(moveDraftRow(rows, 0, 1).map((row) => row.key)).toEqual(["b", "a", "c"]);
  });

  // Verify a move outside the list is refused instead of silently reordering.
  it("refuses a move past either end", () => {
    const rows = [{ key: "a" }, { key: "b" }];

    expect(moveDraftRow(rows, 0, -1)).toBe(rows);
    expect(moveDraftRow(rows, 1, 1)).toBe(rows);
  });

  // Verify removing the last row is allowed, because an empty array is a valid payload.
  it("removes a row and allows an empty list", () => {
    expect(removeDraftRow([{ key: "a" }], 0)).toHaveLength(0);
  });
});

describe("secret row transitions", () => {
  // Verify a stored secret that keeps its name and is not being replaced is kept as is.
  it("keeps a stored value only for the same untouched name", () => {
    const stored = envRow({
      name: "SECRET_TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "SECRET_TOKEN",
    });

    expect(canKeepStoredValue(stored)).toBe(true);
    expect(canKeepStoredValue(setEnvironmentName(stored, "OTHER_TOKEN"))).toBe(false);
    expect(canKeepStoredValue(setEnvironmentSecret(stored, false))).toBe(false);
    expect(canKeepStoredValue(beginReplaceStoredValue(stored))).toBe(false);
  });

  // Verify starting a replacement opens an empty field rather than showing anything stored.
  it("starts a replacement from an empty value", () => {
    const stored = envRow({
      name: "SECRET_TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "SECRET_TOKEN",
    });

    const replacing = { ...beginReplaceStoredValue(stored), value: DUMMY_FE013_SECRET };
    expect(replacing.replaceStoredValue).toBe(true);

    const kept = keepStoredValue(replacing);
    expect(kept.replaceStoredValue).toBe(false);
    expect(kept.value).toBe("");
    expect(canKeepStoredValue(kept)).toBe(true);
  });

  // Verify returning to the stored name after a rename can reach the keep state again.
  it("can return to the stored name and keep the credential", () => {
    const stored = envRow({
      name: "SECRET_TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "SECRET_TOKEN",
    });

    const renamed = setEnvironmentName(stored, "OTHER");
    expect(canKeepStoredValue(renamed)).toBe(false);

    const restored = setEnvironmentName(renamed, "SECRET_TOKEN");
    expect(canKeepStoredValue(restored)).toBe(true);
  });
});

describe("validateCliProfileDraft", () => {
  // Verify a complete, in-range draft produces no error at all.
  it("accepts a valid draft", () => {
    const result = validateCliProfileDraft(validDraft(), SHELLS);

    expect(result.isValid).toBe(true);
    expect(result.firstError).toBeNull();
  });

  // Verify the name rule counts Unicode scalars rather than UTF-16 code units.
  it.each([
    ["", false],
    ["  ", false],
    ["é".repeat(80), true],
    ["é".repeat(81), false],
    ["bad\u0007name", false],
  ])("validates the name %s", (name, valid) => {
    const result = validateCliProfileDraft(validDraft({ name }), SHELLS);

    expect(result.fields.name === undefined).toBe(valid);
  });

  // Verify the command rule counts UTF-8 bytes rather than string length.
  it.each([
    ["", false],
    ["gemini", true],
    ["C:\\Program Files\\Gemini\\gemini.exe", true],
    ["a".repeat(1024), true],
    ["a".repeat(1025), false],
    ["é".repeat(513), false],
    ["bad\u0000command", false],
  ])("validates the command %s", (command, valid) => {
    const result = validateCliProfileDraft(validDraft({ command }), SHELLS);

    expect(result.fields.command === undefined).toBe(valid);
  });

  // Verify the argument row limit is enforced exactly at 128 rows.
  it.each([
    [MAX_ARGUMENT_ROWS, true],
    [MAX_ARGUMENT_ROWS + 1, false],
  ])("validates %s argument rows", (count, valid) => {
    const draft = validDraft({
      arguments: Array.from({ length: count }, (_unused, index) => ({
        key: `arg-${index}`,
        value: "a",
      })),
    });

    expect(validateCliProfileDraft(draft, SHELLS).fields.arguments === undefined).toBe(valid);
  });

  // Verify the 32-KiB total argument budget matches the backend boundary exactly.
  it.each([
    [8, true],
    [9, false],
  ])("validates %s maximum-size arguments in total", (count, valid) => {
    const draft = validDraft({
      arguments: Array.from({ length: count }, (_unused, index) => ({
        key: `arg-${index}`,
        value: "a".repeat(4096),
      })),
    });

    expect(validateCliProfileDraft(draft, SHELLS).fields.arguments === undefined).toBe(valid);
  });

  // Verify one oversized or NUL-bearing argument is reported on its own row.
  it("reports an invalid argument on its row", () => {
    const draft = validDraft({
      arguments: [
        { key: "arg-0", value: "fine" },
        { key: "arg-1", value: "a".repeat(4097) },
        { key: "arg-2", value: "bad\u0000value" },
      ],
    });

    const result = validateCliProfileDraft(draft, SHELLS);

    expect(result.argumentRows["arg-0"]).toBeUndefined();
    expect(result.argumentRows["arg-1"]).toBeDefined();
    expect(result.argumentRows["arg-2"]).toBeDefined();
  });

  // Verify spaces, quotes, backslashes and empty strings are all valid literal arguments.
  it("accepts literal arguments with spaces, quotes, backslashes and empty values", () => {
    const draft = validDraft({
      arguments: [
        { key: "a", value: "--model o3" },
        { key: "b", value: '"quoted value"' },
        { key: "c", value: "C:\\path\\with space" },
        { key: "d", value: "" },
      ],
    });

    expect(validateCliProfileDraft(draft, SHELLS).isValid).toBe(true);
  });

  // Verify a shell override must be a concrete, available catalog entry.
  it.each([
    [null, true],
    ["pwsh", true],
    ["system", false],
    ["not-in-catalog", false],
    ["missing-shell", false],
  ])("validates the shell override %s", (shellId, valid) => {
    // The catalog gains one entry the backend still lists but can no longer resolve.
    const catalog: CliShellDto[] = [
      ...SHELLS,
      {
        id: "missing-shell",
        displayName: "Gone",
        command: "gone.exe",
        isAvailable: false,
        isDefault: false,
      },
    ];

    const result = validateCliProfileDraft(validDraft({ shellId }), catalog);

    expect(result.fields.shell === undefined).toBe(valid);
  });

  // Verify the icon rule counts Unicode scalars and rejects control characters.
  it.each([
    ["", false],
    [">_", true],
    ["é".repeat(16), true],
    ["é".repeat(17), false],
    ["\u0007", false],
  ])("validates the icon %s", (icon, valid) => {
    expect(validateCliProfileDraft(validDraft({ icon }), SHELLS).fields.icon === undefined).toBe(
      valid,
    );
  });

  // Verify the colour rule accepts only a full lowercase #rrggbb value.
  it.each([
    ["#64748b", true],
    ["#64748B", true],
    ["#647", false],
    ["64748b", false],
    ["#64748g", false],
  ])("validates the colour %s", (color, valid) => {
    expect(validateCliProfileDraft(validDraft({ color }), SHELLS).fields.color === undefined).toBe(
      valid,
    );
  });

  // Verify the environment row limit is enforced exactly at 64 rows.
  it.each([
    [MAX_ENVIRONMENT_ROWS, true],
    [MAX_ENVIRONMENT_ROWS + 1, false],
  ])("validates %s environment rows", (count, valid) => {
    const draft = validDraft({
      environment: Array.from({ length: count }, (_unused, index) =>
        envRow({ key: `env-${index}`, name: `VAR_${index}` }),
      ),
    });

    expect(validateCliProfileDraft(draft, SHELLS).fields.environment === undefined).toBe(valid);
  });

  // Verify the environment name pattern matches the backend rule byte for byte.
  it.each([
    ["PATH", true],
    ["_UNDER", true],
    ["A1_b2", true],
    ["", false],
    ["1LEADING", false],
    ["has space", false],
    ["has-dash", false],
    [`A${"b".repeat(127)}`, true],
    [`A${"b".repeat(128)}`, false],
  ])("validates the environment name %s", (name, valid) => {
    const draft = validDraft({ environment: [envRow({ key: "env-0", name })] });

    expect(validateCliProfileDraft(draft, SHELLS).environmentRows["env-0"] === undefined).toBe(
      valid,
    );
  });

  // Verify duplicate names are flagged on every row involved, ignoring ASCII case.
  it("flags every duplicate environment name ignoring case", () => {
    const draft = validDraft({
      environment: [
        envRow({ key: "env-0", name: "TOKEN" }),
        envRow({ key: "env-1", name: "token" }),
        envRow({ key: "env-2", name: "OTHER" }),
      ],
    });

    const result = validateCliProfileDraft(draft, SHELLS);

    expect(result.environmentRows["env-0"]).toBeDefined();
    expect(result.environmentRows["env-1"]).toBeDefined();
    expect(result.environmentRows["env-2"]).toBeUndefined();
  });

  // Verify empty values are valid for both plain and secret rows, and NUL never is.
  it.each([
    ["", false, true],
    ["", true, true],
    ["a".repeat(32 * 1024), false, true],
    ["a".repeat(32 * 1024 + 1), false, false],
    ["bad\u0000value", false, false],
  ])("validates the environment value of length %s", (value, isSecret, valid) => {
    const draft = validDraft({
      environment: [envRow({ key: "env-0", name: "TOKEN", value, isSecret })],
    });

    expect(validateCliProfileDraft(draft, SHELLS).environmentRows["env-0"] === undefined).toBe(
      valid,
    );
  });

  // Verify the first error follows the visible field order so focus lands predictably.
  it("names the first error in visible field order", () => {
    const draft = validDraft({
      name: "",
      command: "",
      icon: "",
      environment: [envRow({ key: "env-0", name: "1BAD" })],
    });

    expect(validateCliProfileDraft(draft, SHELLS).firstError).toEqual({
      field: "name",
      rowKey: null,
    });
    expect(
      validateCliProfileDraft({ ...draft, name: "ok", icon: ">_" }, SHELLS).firstError,
    ).toEqual({ field: "command", rowKey: null });
    expect(
      validateCliProfileDraft({ ...draft, name: "ok", icon: ">_", command: "gemini" }, SHELLS)
        .firstError,
    ).toEqual({ field: "environment", rowKey: "env-0" });
  });
});

describe("buildCliProfileInput", () => {
  // Verify the payload trims only the fields FE-013 says to trim and lowercases the colour.
  it("trims the name, command and icon and lowercases the colour", () => {
    const input = buildCliProfileInput(
      validDraft({ name: "  Gemini  ", command: "  gemini  ", icon: "  Ge  ", color: "#64748B" }),
    );

    expect(input).toMatchObject({
      name: "Gemini",
      command: "gemini",
      icon: "Ge",
      color: "#64748b",
    });
  });

  // Verify each argument row becomes exactly one array element, untouched in every way.
  it("sends every argument literally and in order", () => {
    const input = buildCliProfileInput(
      validDraft({
        arguments: [
          { key: "a", value: "  --model o3  " },
          { key: "b", value: "" },
          { key: "c", value: '"quoted value"' },
          { key: "d", value: "C:\\path\\with space" },
        ],
      }),
    );

    expect(input.arguments).toEqual([
      "  --model o3  ",
      "",
      '"quoted value"',
      "C:\\path\\with space",
    ]);
  });

  // Verify an inherited shell is omitted with `undefined`, exactly as the binding declares.
  it.each([
    [null, undefined],
    ["pwsh", "pwsh"],
  ])("maps the shell override %s", (shellId, expected) => {
    expect(buildCliProfileInput(validDraft({ shellId })).shellId).toBe(expected);
  });

  // Verify a plain variable always carries its value, including an empty string.
  it("always sends a plain value, including an empty one", () => {
    const input = buildCliProfileInput(
      validDraft({ environment: [envRow({ key: "env-0", name: "PLAIN", value: "" })] }),
    );

    expect(input.environment[0]).toEqual({ name: "PLAIN", value: "", isSecret: false });
  });

  // Verify a brand new secret sends its plaintext value, even when that value is empty.
  it.each([
    [DUMMY_FE013_SECRET, DUMMY_FE013_SECRET],
    ["", ""],
  ])("sends a new secret value %s", (value, expected) => {
    const input = buildCliProfileInput(
      validDraft({
        environment: [envRow({ key: "env-0", name: "TOKEN", value, isSecret: true })],
      }),
    );

    expect(input.environment[0]).toEqual({ name: "TOKEN", value: expected, isSecret: true });
  });

  // Verify an untouched stored secret omits `value` so the backend keeps its credential.
  it("omits the value of an unchanged stored secret", () => {
    const input = buildCliProfileInput(
      validDraft({
        environment: [
          envRow({
            key: "env-0",
            name: "TOKEN",
            value: "",
            isSecret: true,
            hasStoredValue: true,
            storedName: "TOKEN",
          }),
        ],
      }),
    );

    expect(input.environment[0]).toEqual({ name: "TOKEN", isSecret: true });
    expect("value" in input.environment[0]).toBe(false);
  });

  // Verify a replacement sends the newly typed value rather than reusing anything stored.
  it("sends a replacement value for a stored secret", () => {
    const stored = envRow({
      key: "env-0",
      name: "TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "TOKEN",
    });
    const replacing = { ...beginReplaceStoredValue(stored), value: DUMMY_FE013_SECRET };

    const input = buildCliProfileInput(validDraft({ environment: [replacing] }));

    expect(input.environment[0]).toEqual({
      name: "TOKEN",
      value: DUMMY_FE013_SECRET,
      isSecret: true,
    });
  });

  // Verify a renamed stored secret is treated as new, so no old credential can be reused.
  it("sends a concrete value for a renamed stored secret", () => {
    const stored = envRow({
      key: "env-0",
      name: "TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "TOKEN",
    });

    const input = buildCliProfileInput(
      validDraft({ environment: [setEnvironmentName(stored, "TOKEN_2")] }),
    );

    expect(input.environment[0]).toEqual({ name: "TOKEN_2", value: "", isSecret: true });
  });

  // Verify converting a stored secret to plain text sends a concrete new value instead.
  it("sends a concrete value when a stored secret becomes plain text", () => {
    const stored = envRow({
      key: "env-0",
      name: "TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "TOKEN",
    });
    const plain = { ...setEnvironmentSecret(stored, false), value: "visible" };

    const input = buildCliProfileInput(validDraft({ environment: [plain] }));

    expect(input.environment[0]).toEqual({ name: "TOKEN", value: "visible", isSecret: false });
  });

  // Verify choosing `Keep stored value` drops the replacement the user had already typed.
  it("drops a typed replacement once the stored value is kept again", () => {
    const stored = envRow({
      key: "env-0",
      name: "TOKEN",
      value: "",
      isSecret: true,
      hasStoredValue: true,
      storedName: "TOKEN",
    });
    const typed = { ...beginReplaceStoredValue(stored), value: DUMMY_FE013_SECRET };

    const input = buildCliProfileInput(validDraft({ environment: [keepStoredValue(typed)] }));

    expect(input.environment[0]).toEqual({ name: "TOKEN", isSecret: true });
    expect(JSON.stringify(input)).not.toContain(DUMMY_FE013_SECRET);
  });

  // Verify row keys stay a frontend concern and never reach the generated payload.
  it("never sends a row key", () => {
    const input = buildCliProfileInput(
      validDraft({
        arguments: [{ key: "arg-0", value: "--yolo" }],
        environment: [envRow({ key: "env-0" })],
      }),
    );

    expect(JSON.stringify(input)).not.toContain("env-0");
    expect(JSON.stringify(input)).not.toContain("arg-0");
  });
});
