import type {
  CliProfileDto,
  CliProfileEnvironmentDto,
  CliProfilesSnapshotDto,
  CliShellDto,
} from "@/bindings/terminal/cli-profiles";

/** The exact BE-006 built-in identifiers, so fixtures cannot drift from the backend. */
export const BUILT_IN_CODEX_ID = "builtin:codex";
export const BUILT_IN_CLAUDE_ID = "builtin:claude";
export const BUILT_IN_TERMINAL_ID = "builtin:terminal";

/**
 * The only value a focused test ever types into a secret field. It is a sentinel, never a
 * real credential, so a leaked assertion or a captured DOM node exposes nothing.
 */
export const DUMMY_FE013_SECRET = "fe013-dummy-secret";

/** Build one catalog shell with the generated shape and sensible Windows defaults. */
export function createCliShellDto(overrides: Partial<CliShellDto> = {}): CliShellDto {
  return {
    id: "pwsh",
    displayName: "PowerShell 7",
    command: "pwsh.exe",
    isAvailable: true,
    isDefault: false,
    ...overrides,
  };
}

/** Build the four-entry shell catalog the Windows smoke path also produces. */
export function createCliShellCatalog(): CliShellDto[] {
  return [
    createCliShellDto({
      id: "system",
      displayName: "System default",
      command: "pwsh.exe",
      isDefault: true,
    }),
    createCliShellDto({ id: "pwsh", displayName: "PowerShell 7", command: "pwsh.exe" }),
    createCliShellDto({
      id: "windows-powershell",
      displayName: "Windows PowerShell",
      command: "powershell.exe",
    }),
    createCliShellDto({ id: "cmd", displayName: "Command Prompt", command: "cmd.exe" }),
  ];
}

/** Build one environment entry. A stored secret is `value: null` plus `hasStoredValue: true`. */
export function createCliEnvironmentDto(
  overrides: Partial<CliProfileEnvironmentDto> = {},
): CliProfileEnvironmentDto {
  return {
    name: "GEMINI_MODE",
    value: "fast",
    isSecret: false,
    hasStoredValue: false,
    ...overrides,
  };
}

/** Build one stored-secret entry, which never carries a plaintext value in any direction. */
export function createStoredSecretDto(name = "XWORK_FE013_SMOKE_SECRET"): CliProfileEnvironmentDto {
  return { name, value: null, isSecret: true, hasStoredValue: true };
}

/** Build one profile DTO with the generated shape and a checked, available default. */
export function createCliProfileDto(overrides: Partial<CliProfileDto> = {}): CliProfileDto {
  return {
    id: BUILT_IN_CODEX_ID,
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

/** Build the three built-ins in their exact contract order: Codex, Claude, Terminal. */
export function createBuiltInProfiles(): CliProfileDto[] {
  return [
    createCliProfileDto(),
    createCliProfileDto({
      id: BUILT_IN_CLAUDE_ID,
      name: "Claude",
      command: "claude",
      icon: "Cl",
      color: "#d97757",
    }),
    createCliProfileDto({
      id: BUILT_IN_TERMINAL_ID,
      name: "Terminal",
      command: "pwsh.exe",
      icon: ">_",
      color: "#64748b",
    }),
  ];
}

/** Build one custom profile, which is the only kind the editor and delete flows accept. */
export function createCustomProfileDto(overrides: Partial<CliProfileDto> = {}): CliProfileDto {
  return createCliProfileDto({
    id: "custom-1",
    name: "Gemini CLI",
    kind: "custom",
    command: "gemini",
    arguments: ["--yolo"],
    icon: "Ge",
    color: "#5db8a6",
    availability: { status: "available", checkedAtUnixMs: "1700000000000" },
    ...overrides,
  });
}

/** Build a complete snapshot: revision `0`, the system default, the catalog and the built-ins. */
export function createCliProfilesSnapshot(
  overrides: Partial<CliProfilesSnapshotDto> = {},
): CliProfilesSnapshotDto {
  return {
    revision: "0",
    defaultShellId: "system",
    effectiveDefaultShellId: "pwsh",
    shells: createCliShellCatalog(),
    profiles: createBuiltInProfiles(),
    ...overrides,
  };
}
