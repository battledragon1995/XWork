import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** Label shown when no language pack applies, including for a `null` syntax hint. */
export const PLAIN_TEXT_LABEL = "Plain text";

/**
 * Ceiling above which highlighting is skipped entirely. Equality stays eligible: the FE-017
 * rule is "greater than", so a file sitting exactly on a threshold is still highlighted.
 */
export const SYNTAX_LIMIT = {
  byteSize: 2_097_152n,
  lineCount: 20_000,
} as const;

/** One resolved language: its status-bar label plus how to load its parser on demand. */
export interface SourceLanguageEntry {
  /** Stable identifier used by tests and diagnostics; never shown to the user. */
  readonly id: string;
  readonly label: string;
  /** Package the parser comes from; a static specifier so the bundler can split it out. */
  readonly module: string;
  /** Export read from that package. */
  readonly exportName: string;
  /** Options handed to the package factory, when the package takes any. */
  readonly options?: Readonly<Record<string, boolean>>;
  /** Whether the export is a legacy stream parser that needs `StreamLanguage`. */
  readonly stream: boolean;
  /** Load the parser. Rejection is handled once by the caller, never retried in a loop. */
  load(): Promise<Extension>;
}

/** One row of the FE-017 language table before its loader is attached. */
interface SourceLanguageDefinition {
  id: string;
  label: string;
  module: string;
  exportName: string;
  options?: Record<string, boolean>;
  stream?: true;
  /** Every lowercase extension the backend can report for this language. */
  hints: string[];
}

/** Factory shape the Lezer language packages expose. */
type LanguageFactory = (options?: Record<string, boolean>) => Extension;

/**
 * One static import specifier per package. Keeping the specifiers literal lets Vite emit a
 * separate chunk per language, so opening a Rust file never downloads the PHP grammar.
 */
const MODULE_LOADERS: Record<string, () => Promise<unknown>> = {
  "@codemirror/lang-rust": () => import("@codemirror/lang-rust"),
  "@codemirror/lang-javascript": () => import("@codemirror/lang-javascript"),
  "@codemirror/lang-json": () => import("@codemirror/lang-json"),
  "@codemirror/lang-html": () => import("@codemirror/lang-html"),
  "@codemirror/lang-css": () => import("@codemirror/lang-css"),
  "@codemirror/lang-markdown": () => import("@codemirror/lang-markdown"),
  "@codemirror/lang-python": () => import("@codemirror/lang-python"),
  "@codemirror/lang-yaml": () => import("@codemirror/lang-yaml"),
  "@codemirror/lang-xml": () => import("@codemirror/lang-xml"),
  "@codemirror/lang-sql": () => import("@codemirror/lang-sql"),
  "@codemirror/lang-java": () => import("@codemirror/lang-java"),
  "@codemirror/lang-cpp": () => import("@codemirror/lang-cpp"),
  "@codemirror/lang-php": () => import("@codemirror/lang-php"),
  "@codemirror/lang-go": () => import("@codemirror/lang-go"),
  "@codemirror/legacy-modes/mode/shell": () => import("@codemirror/legacy-modes/mode/shell"),
  "@codemirror/legacy-modes/mode/powershell": () =>
    import("@codemirror/legacy-modes/mode/powershell"),
  "@codemirror/legacy-modes/mode/toml": () => import("@codemirror/legacy-modes/mode/toml"),
};

/** The exact FE-017 extension table. Nothing here inspects a basename or file content. */
const DEFINITIONS: SourceLanguageDefinition[] = [
  {
    id: "rust",
    label: "Rust",
    module: "@codemirror/lang-rust",
    exportName: "rust",
    hints: ["rs"],
  },
  {
    id: "typescript",
    label: "TypeScript",
    module: "@codemirror/lang-javascript",
    exportName: "javascript",
    options: { typescript: true },
    hints: ["ts", "mts", "cts"],
  },
  {
    id: "typescript-jsx",
    label: "TypeScript JSX",
    module: "@codemirror/lang-javascript",
    exportName: "javascript",
    options: { typescript: true, jsx: true },
    hints: ["tsx"],
  },
  {
    id: "javascript",
    label: "JavaScript",
    module: "@codemirror/lang-javascript",
    exportName: "javascript",
    hints: ["js", "mjs", "cjs"],
  },
  {
    id: "javascript-jsx",
    label: "JavaScript JSX",
    module: "@codemirror/lang-javascript",
    exportName: "javascript",
    options: { jsx: true },
    hints: ["jsx"],
  },
  {
    id: "json",
    label: "JSON",
    module: "@codemirror/lang-json",
    exportName: "json",
    hints: ["json", "jsonc"],
  },
  {
    id: "html",
    label: "HTML",
    module: "@codemirror/lang-html",
    exportName: "html",
    hints: ["html", "htm"],
  },
  { id: "css", label: "CSS", module: "@codemirror/lang-css", exportName: "css", hints: ["css"] },
  {
    id: "markdown",
    label: "Markdown",
    module: "@codemirror/lang-markdown",
    exportName: "markdown",
    hints: ["md", "markdown"],
  },
  {
    id: "python",
    label: "Python",
    module: "@codemirror/lang-python",
    exportName: "python",
    hints: ["py", "pyi"],
  },
  {
    id: "yaml",
    label: "YAML",
    module: "@codemirror/lang-yaml",
    exportName: "yaml",
    hints: ["yaml", "yml"],
  },
  {
    id: "xml",
    label: "XML",
    module: "@codemirror/lang-xml",
    exportName: "xml",
    hints: ["xml", "svg"],
  },
  { id: "sql", label: "SQL", module: "@codemirror/lang-sql", exportName: "sql", hints: ["sql"] },
  {
    id: "java",
    label: "Java",
    module: "@codemirror/lang-java",
    exportName: "java",
    hints: ["java"],
  },
  // C reuses the C++ grammar, which parses C sources, but keeps its own status-bar label.
  { id: "c", label: "C", module: "@codemirror/lang-cpp", exportName: "cpp", hints: ["c", "h"] },
  {
    id: "cpp",
    label: "C++",
    module: "@codemirror/lang-cpp",
    exportName: "cpp",
    hints: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
  },
  { id: "php", label: "PHP", module: "@codemirror/lang-php", exportName: "php", hints: ["php"] },
  { id: "go", label: "Go", module: "@codemirror/lang-go", exportName: "go", hints: ["go"] },
  {
    id: "shell",
    label: "Shell",
    module: "@codemirror/legacy-modes/mode/shell",
    exportName: "shell",
    stream: true,
    hints: ["sh", "bash", "zsh"],
  },
  {
    id: "powershell",
    label: "PowerShell",
    module: "@codemirror/legacy-modes/mode/powershell",
    exportName: "powerShell",
    stream: true,
    hints: ["ps1", "psm1"],
  },
  {
    id: "toml",
    label: "TOML",
    module: "@codemirror/legacy-modes/mode/toml",
    exportName: "toml",
    stream: true,
    hints: ["toml"],
  },
];

/** Import the package for one definition and turn its export into a CodeMirror extension. */
async function loadDefinition(definition: SourceLanguageDefinition): Promise<Extension> {
  const loader = MODULE_LOADERS[definition.module];
  if (!loader) throw new Error(`No loader registered for ${definition.module}`);
  const namespace = (await loader()) as Record<string, unknown>;
  const exported = namespace[definition.exportName];
  if (!exported) throw new Error(`${definition.module} exports no ${definition.exportName}`);
  // Legacy modes ship a stream parser rather than a Lezer grammar, so they need wrapping.
  if (definition.stream) return StreamLanguage.define(exported as StreamParser<unknown>);
  const factory = exported as LanguageFactory;
  return definition.options ? factory(definition.options) : factory();
}

/** Turn one table row into the frozen public entry every caller shares. */
function toEntry(definition: SourceLanguageDefinition): SourceLanguageEntry {
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    module: definition.module,
    exportName: definition.exportName,
    options: definition.options,
    stream: definition.stream === true,
    // Load lazily so a viewer that never opens this language never pays for its grammar.
    load: () => loadDefinition(definition),
  });
}

/** Every alias resolved once at module load; lookups afterwards are exact and case-sensitive. */
const ENTRIES_BY_HINT = new Map<string, SourceLanguageEntry>(
  DEFINITIONS.flatMap((definition) => {
    const entry = toEntry(definition);
    return definition.hints.map((hint) => [hint, entry] as const);
  }),
);

/** Decide whether a snapshot is small enough to be worth loading a language pack for. */
export function isSyntaxHighlightingEligible(file: {
  byteSize: bigint;
  lineCount: number;
}): boolean {
  return file.byteSize <= SYNTAX_LIMIT.byteSize && file.lineCount <= SYNTAX_LIMIT.lineCount;
}

/**
 * Resolve the backend syntax hint to a language, or `null` for plain text. BE-014 guarantees a
 * lowercase extension without a dot, so the lookup stays exact instead of guessing variants.
 */
export function sourceLanguage(syntaxHint: string | null): SourceLanguageEntry | null {
  if (syntaxHint === null) return null;
  return ENTRIES_BY_HINT.get(syntaxHint) ?? null;
}

/** Resolve only the status-bar label, which always has a value. */
export function sourceLanguageLabel(syntaxHint: string | null): string {
  return sourceLanguage(syntaxHint)?.label ?? PLAIN_TEXT_LABEL;
}
