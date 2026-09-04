import type {
  CliProfileDto,
  CliProfileEnvironmentInputDto,
  CliProfileInputDto,
  CliShellDto,
} from "@/bindings/terminal/cli-profiles";

/** Maximum number of literal argument rows one profile may carry. */
export const MAX_ARGUMENT_ROWS = 128;

/** Maximum UTF-8 size of one argument. */
export const MAX_ARGUMENT_BYTES = 4096;

/** Maximum UTF-8 size of every argument added together. */
export const MAX_ARGUMENTS_TOTAL_BYTES = 32 * 1024;

/** Maximum number of environment rows one profile may carry. */
export const MAX_ENVIRONMENT_ROWS = 64;

/** Maximum UTF-8 size of one environment value. */
export const MAX_ENVIRONMENT_VALUE_BYTES = 32 * 1024;

/** Maximum UTF-8 size of one environment name. */
export const MAX_ENVIRONMENT_NAME_BYTES = 128;

/** Maximum UTF-8 size of one command. */
export const MAX_COMMAND_BYTES = 1024;

/** Maximum Unicode scalar count of one display name. */
export const MAX_NAME_SCALARS = 80;

/** Maximum Unicode scalar count of one icon label. */
export const MAX_ICON_SCALARS = 16;

/** Icon a brand new profile starts with, matching the built-in Terminal mark. */
export const DEFAULT_PROFILE_ICON = ">_";

/** Colour a brand new profile starts with, matching the built-in Terminal mark. */
export const DEFAULT_PROFILE_COLOR = "#64748b";

/** Catalog id that stands for the resolved system shell and can never be an override. */
export const SYSTEM_SHELL_ID = "system";

/** One ordered literal argument row. `key` exists only so React can identify the row. */
export interface CliArgumentDraft {
  key: string;
  value: string;
}

/**
 * One ordered environment row. `storedName` is the name the backend's credential belongs to,
 * which is what makes a rename detectable: a stored secret can only be kept while the row
 * still carries the exact name it was saved under.
 */
export interface CliEnvironmentDraft {
  key: string;
  name: string;
  value: string;
  isSecret: boolean;
  hasStoredValue: boolean;
  storedName: string | null;
  replaceStoredValue: boolean;
}

/** The whole editable state of one profile while the sheet is open. */
export interface CliProfileDraft {
  mode: "create" | "edit";
  profileId: string | null;
  name: string;
  command: string;
  arguments: CliArgumentDraft[];
  shellId: string | null;
  icon: string;
  color: string;
  environment: CliEnvironmentDraft[];
}

/** Every field or group a validation message can attach to, in visible order. */
export type CliProfileFormField =
  | "name"
  | "icon"
  | "color"
  | "command"
  | "arguments"
  | "shell"
  | "environment";

/** Result of one local validation pass over a draft. */
export interface CliProfileValidation {
  isValid: boolean;
  fields: Partial<Record<CliProfileFormField, string>>;
  argumentRows: Record<string, string>;
  environmentRows: Record<string, string>;
  firstError: { field: CliProfileFormField; rowKey: string | null } | null;
}

/** Monotonic counter behind every row key. Keys never leave the frontend. */
let rowKeyCounter = 0;

/** Hand out one row key that is unique for the lifetime of the page. */
function nextRowKey(prefix: string): string {
  rowKeyCounter += 1;
  return `${prefix}-${rowKeyCounter}`;
}

/** Shared encoder, so a byte limit is never approximated with `string.length`. */
const encoder = new TextEncoder();

/** Measure one value in UTF-8 bytes, which is the unit every backend size limit uses. */
function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** Count Unicode scalars, which is the unit the name and icon limits use. */
function scalarLength(value: string): number {
  return Array.from(value).length;
}

/** Report whether a value carries a C0/C1 control character the backend rejects. */
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

/** Build the draft a brand new profile starts from. */
export function createEmptyProfileDraft(): CliProfileDraft {
  return {
    mode: "create",
    profileId: null,
    name: "",
    command: "",
    arguments: [],
    shellId: null,
    icon: DEFAULT_PROFILE_ICON,
    color: DEFAULT_PROFILE_COLOR,
    environment: [],
  };
}

/**
 * Map one saved profile onto an editable draft. A stored secret arrives as `value: null`, so
 * the row starts with an empty string: the plaintext is not readable by anyone, this frontend
 * included, and nothing that looks like a value may be shown in its place.
 */
export function createEditProfileDraft(profile: CliProfileDto): CliProfileDraft {
  return {
    mode: "edit",
    profileId: profile.id,
    name: profile.name,
    command: profile.command ?? "",
    arguments: profile.arguments.map((value) => ({ key: nextRowKey("arg"), value })),
    shellId: profile.shellId,
    icon: profile.icon,
    color: profile.color,
    environment: profile.environment.map((entry) => ({
      key: nextRowKey("env"),
      name: entry.name,
      value: entry.value ?? "",
      isSecret: entry.isSecret,
      hasStoredValue: entry.hasStoredValue,
      storedName: entry.hasStoredValue ? entry.name : null,
      replaceStoredValue: false,
    })),
  };
}

/** Append one empty argument row. */
export function addArgumentRow(draft: CliProfileDraft): CliProfileDraft {
  return { ...draft, arguments: [...draft.arguments, { key: nextRowKey("arg"), value: "" }] };
}

/** Append one empty plain environment row. */
export function addEnvironmentRow(draft: CliProfileDraft): CliProfileDraft {
  return {
    ...draft,
    environment: [
      ...draft.environment,
      {
        key: nextRowKey("env"),
        name: "",
        value: "",
        isSecret: false,
        hasStoredValue: false,
        storedName: null,
        replaceStoredValue: false,
      },
    ],
  };
}

/** Remove one row by index. Emptying a list is allowed, because an empty array is valid. */
export function removeDraftRow<TRow>(rows: readonly TRow[], index: number): TRow[] {
  return rows.filter((_row, position) => position !== index);
}

/** Move one row by the given offset, or return the list unchanged when that leaves it. */
export function moveDraftRow<TRow>(rows: readonly TRow[], index: number, offset: number): TRow[] {
  const target = index + offset;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
    return rows as TRow[];
  }

  const next = [...rows];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as TRow);
  return next;
}

/**
 * Report whether the backend's stored credential still belongs to this row. Only a secret row
 * that kept its exact saved name and was not put into replace mode may omit its value.
 */
export function canKeepStoredValue(row: CliEnvironmentDraft): boolean {
  return (
    row.isSecret && row.hasStoredValue && row.storedName === row.name && !row.replaceStoredValue
  );
}

/** Rename one environment row without ever reusing a credential saved under the old name. */
export function setEnvironmentName(row: CliEnvironmentDraft, name: string): CliEnvironmentDraft {
  return { ...row, name };
}

/** Toggle the Secret switch, keeping whatever the user is currently typing in the row. */
export function setEnvironmentSecret(
  row: CliEnvironmentDraft,
  isSecret: boolean,
): CliEnvironmentDraft {
  return { ...row, isSecret };
}

/** Open an empty replacement field. The previous value is never reconstructed or shown. */
export function beginReplaceStoredValue(row: CliEnvironmentDraft): CliEnvironmentDraft {
  return { ...row, replaceStoredValue: true, value: "" };
}

/** Cancel a replacement and drop the plaintext the user had typed into the row. */
export function keepStoredValue(row: CliEnvironmentDraft): CliEnvironmentDraft {
  return { ...row, replaceStoredValue: false, value: "" };
}

/** Build the comparable signature of one environment row. */
function environmentSignature(row: CliEnvironmentDraft): string {
  const value = canKeepStoredValue(row) ? "kept" : row.value;
  return [row.name, String(row.isSecret), String(row.replaceStoredValue), value].join("\u0000");
}

/** Build the comparable signature of one draft, covering only the editable source fields. */
function draftSignature(draft: CliProfileDraft): string {
  return [
    draft.name,
    draft.command,
    draft.shellId ?? "",
    draft.icon,
    draft.color,
    draft.arguments.map((row) => row.value).join("\u0000"),
    String(draft.arguments.length),
    draft.environment.map(environmentSignature).join(""),
  ].join("");
}

/**
 * Report whether the sheet holds unsaved work. The comparison covers only what the editor can
 * change, so a background availability or effective-shell refresh never turns a clean draft
 * dirty and never blocks its automatic resynchronization.
 */
export function isCliProfileDraftDirty(
  draft: CliProfileDraft,
  source: CliProfileDto | null,
): boolean {
  const baseline = source === null ? createEmptyProfileDraft() : createEditProfileDraft(source);
  return draftSignature(draft) !== draftSignature(baseline);
}

/** Validate the name against the platform-independent scalar rule. */
function validateName(name: string): string | undefined {
  const trimmed = name.trim();
  const scalars = scalarLength(trimmed);
  if (scalars === 0 || scalars > MAX_NAME_SCALARS || hasControlCharacter(trimmed)) {
    return `Enter a name between 1 and ${MAX_NAME_SCALARS} characters.`;
  }
  return undefined;
}

/**
 * Validate the command's shape and size only. Whether a bare name or an absolute path is
 * usable on this operating system stays a backend decision, so no second path parser exists.
 */
function validateCommand(command: string): string | undefined {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return "Enter a command.";
  }
  if (byteLength(trimmed) > MAX_COMMAND_BYTES || hasControlCharacter(trimmed)) {
    return `Use a command of at most ${MAX_COMMAND_BYTES} bytes, without control characters.`;
  }
  return undefined;
}

/** Validate the icon against the platform-independent scalar rule. */
function validateIcon(icon: string): string | undefined {
  const trimmed = icon.trim();
  const scalars = scalarLength(trimmed);
  if (scalars === 0 || scalars > MAX_ICON_SCALARS || hasControlCharacter(trimmed)) {
    return `Enter an icon between 1 and ${MAX_ICON_SCALARS} characters.`;
  }
  return undefined;
}

/** Validate the colour after the same lowercase normalization the payload uses. */
function validateColor(color: string): string | undefined {
  return /^#[0-9a-f]{6}$/.test(color.toLowerCase()) ? undefined : "Use a #rrggbb colour.";
}

/** Validate one shell override against the catalog the backend returned. */
function validateShell(shellId: string | null, shells: readonly CliShellDto[]): string | undefined {
  if (shellId === null) {
    return undefined;
  }

  const shell = shells.find((entry) => entry.id === shellId);
  if (shellId === SYSTEM_SHELL_ID || shell === undefined || !shell.isAvailable) {
    return "Pick an available shell, or use the default shell.";
  }
  return undefined;
}

/** Validate one environment name against the exact backend pattern and byte limit. */
function validateEnvironmentName(name: string): string | undefined {
  if (byteLength(name) > MAX_ENVIRONMENT_NAME_BYTES || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use a name that starts with a letter or underscore and contains only letters, digits and underscores.";
  }
  return undefined;
}

/** Validate one environment value. An empty value is valid for plain and secret rows alike. */
function validateEnvironmentValue(value: string): string | undefined {
  if (value.includes("\u0000")) {
    return "Remove the NUL character from this value.";
  }
  if (byteLength(value) > MAX_ENVIRONMENT_VALUE_BYTES) {
    return "Use at most 32 KB in one value.";
  }
  return undefined;
}

/**
 * Run every platform-independent FE-013 rule over one draft. The backend re-checks all of it
 * and stays the final authority; this pass only puts a message next to the right control.
 */
export function validateCliProfileDraft(
  draft: CliProfileDraft,
  shells: readonly CliShellDto[],
): CliProfileValidation {
  const fields: Partial<Record<CliProfileFormField, string>> = {};
  const argumentRows: Record<string, string> = {};
  const environmentRows: Record<string, string> = {};

  const name = validateName(draft.name);
  if (name !== undefined) {
    fields.name = name;
  }
  const icon = validateIcon(draft.icon);
  if (icon !== undefined) {
    fields.icon = icon;
  }
  const color = validateColor(draft.color);
  if (color !== undefined) {
    fields.color = color;
  }
  const command = validateCommand(draft.command);
  if (command !== undefined) {
    fields.command = command;
  }
  const shell = validateShell(draft.shellId, shells);
  if (shell !== undefined) {
    fields.shell = shell;
  }

  if (draft.arguments.length > MAX_ARGUMENT_ROWS) {
    fields.arguments = `A profile allows at most ${MAX_ARGUMENT_ROWS} arguments.`;
  }
  let argumentTotal = 0;
  for (const row of draft.arguments) {
    argumentTotal += byteLength(row.value);
    if (row.value.includes("\u0000")) {
      argumentRows[row.key] = "Remove the NUL character from this argument.";
    } else if (byteLength(row.value) > MAX_ARGUMENT_BYTES) {
      argumentRows[row.key] = `Use at most ${MAX_ARGUMENT_BYTES} bytes in one argument.`;
    }
  }
  if (argumentTotal > MAX_ARGUMENTS_TOTAL_BYTES && fields.arguments === undefined) {
    fields.arguments = "All arguments together must stay under 32 KB.";
  }

  if (draft.environment.length > MAX_ENVIRONMENT_ROWS) {
    fields.environment = `A profile allows at most ${MAX_ENVIRONMENT_ROWS} environment variables.`;
  }
  // Names collide case-insensitively on every platform the backend supports, so the duplicate
  // set is built from the upper-cased ASCII form rather than the literal text.
  const seen = new Map<string, string[]>();
  for (const row of draft.environment) {
    const folded = row.name.toUpperCase();
    seen.set(folded, [...(seen.get(folded) ?? []), row.key]);
  }
  for (const row of draft.environment) {
    const nameError = validateEnvironmentName(row.name);
    const duplicate = (seen.get(row.name.toUpperCase()) ?? []).length > 1;
    const valueError = validateEnvironmentValue(row.value);

    if (nameError !== undefined) {
      environmentRows[row.key] = nameError;
    } else if (duplicate) {
      environmentRows[row.key] = "Environment names must be unique, ignoring upper and lower case.";
    } else if (valueError !== undefined) {
      environmentRows[row.key] = valueError;
    }
  }

  const firstError = readFirstError(draft, fields, argumentRows, environmentRows);

  return {
    isValid: firstError === null,
    fields,
    argumentRows,
    environmentRows,
    firstError,
  };
}

/** Resolve the first error in visible field order, so focus lands where the user reads. */
function readFirstError(
  draft: CliProfileDraft,
  fields: Partial<Record<CliProfileFormField, string>>,
  argumentRows: Record<string, string>,
  environmentRows: Record<string, string>,
): CliProfileValidation["firstError"] {
  const order: CliProfileFormField[] = [
    "name",
    "icon",
    "color",
    "command",
    "arguments",
    "shell",
    "environment",
  ];

  for (const field of order) {
    if (fields[field] !== undefined) {
      return { field, rowKey: null };
    }
    if (field === "arguments") {
      const row = draft.arguments.find((entry) => argumentRows[entry.key] !== undefined);
      if (row !== undefined) {
        return { field: "arguments", rowKey: row.key };
      }
    }
    if (field === "environment") {
      const row = draft.environment.find((entry) => environmentRows[entry.key] !== undefined);
      if (row !== undefined) {
        return { field: "environment", rowKey: row.key };
      }
    }
  }

  return null;
}

/** Build one environment entry for the payload, omitting a value only to keep a credential. */
function buildEnvironmentInput(row: CliEnvironmentDraft): CliProfileEnvironmentInputDto {
  // Omitting `value` is the single documented way to say "keep the stored credential". Every
  // other state — new, replaced, renamed or converted to plain — must send a concrete value,
  // including an empty string, because neither layer can read the old secret back.
  if (canKeepStoredValue(row)) {
    return { name: row.name, isSecret: true };
  }

  return { name: row.name, value: row.value, isSecret: row.isSecret };
}

/**
 * Build the full replacement payload one create or update sends. Arguments are copied one to
 * one: nothing is trimmed, split, quoted, escaped or joined, so a value with spaces stays a
 * single argument all the way to the process the backend eventually launches.
 */
export function buildCliProfileInput(draft: CliProfileDraft): CliProfileInputDto {
  return {
    name: draft.name.trim(),
    command: draft.command.trim(),
    arguments: draft.arguments.map((row) => row.value),
    shellId: draft.shellId ?? undefined,
    icon: draft.icon.trim(),
    color: draft.color.toLowerCase(),
    environment: draft.environment.map(buildEnvironmentInput),
  };
}
