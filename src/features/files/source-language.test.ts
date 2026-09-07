import { describe, expect, it } from "vitest";
import {
  isSyntaxHighlightingEligible,
  PLAIN_TEXT_LABEL,
  sourceLanguage,
  sourceLanguageLabel,
  SYNTAX_LIMIT,
} from "./source-language";

/** Every alias FE-017 lists, paired with the identifier and label it must resolve to. */
const ALIASES: readonly [string, string, string][] = [
  ["rs", "rust", "Rust"],
  ["ts", "typescript", "TypeScript"],
  ["mts", "typescript", "TypeScript"],
  ["cts", "typescript", "TypeScript"],
  ["tsx", "typescript-jsx", "TypeScript JSX"],
  ["js", "javascript", "JavaScript"],
  ["mjs", "javascript", "JavaScript"],
  ["cjs", "javascript", "JavaScript"],
  ["jsx", "javascript-jsx", "JavaScript JSX"],
  ["json", "json", "JSON"],
  ["jsonc", "json", "JSON"],
  ["html", "html", "HTML"],
  ["htm", "html", "HTML"],
  ["css", "css", "CSS"],
  ["md", "markdown", "Markdown"],
  ["markdown", "markdown", "Markdown"],
  ["py", "python", "Python"],
  ["pyi", "python", "Python"],
  ["yaml", "yaml", "YAML"],
  ["yml", "yaml", "YAML"],
  ["xml", "xml", "XML"],
  ["svg", "xml", "XML"],
  ["sql", "sql", "SQL"],
  ["java", "java", "Java"],
  ["c", "c", "C"],
  ["h", "c", "C"],
  ["cpp", "cpp", "C++"],
  ["cc", "cpp", "C++"],
  ["cxx", "cpp", "C++"],
  ["hpp", "cpp", "C++"],
  ["hh", "cpp", "C++"],
  ["hxx", "cpp", "C++"],
  ["php", "php", "PHP"],
  ["go", "go", "Go"],
  ["sh", "shell", "Shell"],
  ["bash", "shell", "Shell"],
  ["zsh", "shell", "Shell"],
  ["ps1", "powershell", "PowerShell"],
  ["psm1", "powershell", "PowerShell"],
  ["toml", "toml", "TOML"],
];

describe("sourceLanguage", () => {
  /** Each alias in the FE-017 table resolves to its own language and label. */
  it.each(ALIASES)("maps %s to %s", (hint, id, label) => {
    const entry = sourceLanguage(hint);
    expect(entry?.id).toBe(id);
    expect(entry?.label).toBe(label);
    expect(sourceLanguageLabel(hint)).toBe(label);
  });

  /** The two TypeScript variants must reach the same package with different options. */
  it("passes TypeScript and JSX options to the JavaScript package", () => {
    expect(sourceLanguage("ts")).toMatchObject({
      module: "@codemirror/lang-javascript",
      exportName: "javascript",
      options: { typescript: true },
      stream: false,
    });
    expect(sourceLanguage("tsx")).toMatchObject({
      module: "@codemirror/lang-javascript",
      exportName: "javascript",
      options: { typescript: true, jsx: true },
    });
    expect(sourceLanguage("jsx")).toMatchObject({
      module: "@codemirror/lang-javascript",
      options: { jsx: true },
    });
    expect(sourceLanguage("js")?.options).toBeUndefined();
  });

  /** C and C++ share one package but stay separate labels. */
  it("shares the C++ package between C and C++", () => {
    expect(sourceLanguage("c")).toMatchObject({
      module: "@codemirror/lang-cpp",
      exportName: "cpp",
      label: "C",
    });
    expect(sourceLanguage("hpp")).toMatchObject({
      module: "@codemirror/lang-cpp",
      exportName: "cpp",
      label: "C++",
    });
  });

  /** Shell, PowerShell and TOML come from legacy stream modes, not Lezer packages. */
  it("routes legacy modes through StreamLanguage", () => {
    expect(sourceLanguage("bash")).toMatchObject({
      module: "@codemirror/legacy-modes/mode/shell",
      exportName: "shell",
      stream: true,
    });
    expect(sourceLanguage("psm1")).toMatchObject({
      module: "@codemirror/legacy-modes/mode/powershell",
      exportName: "powerShell",
      stream: true,
    });
    expect(sourceLanguage("toml")).toMatchObject({
      module: "@codemirror/legacy-modes/mode/toml",
      exportName: "toml",
      stream: true,
    });
  });

  /** A missing extension is plain text; the frontend never guesses from a basename. */
  it("treats a null hint as plain text", () => {
    expect(sourceLanguage(null)).toBeNull();
    expect(sourceLanguageLabel(null)).toBe(PLAIN_TEXT_LABEL);
  });

  /** Unknown hints, including well-known extensionless names, stay plain text. */
  it.each(["", "txt", "makefile", "dockerfile", "lock", "rs.bak", "RS", " rs"])(
    "treats %s as plain text",
    (hint) => {
      expect(sourceLanguage(hint)).toBeNull();
      expect(sourceLanguageLabel(hint)).toBe(PLAIN_TEXT_LABEL);
    },
  );
});

describe("SourceLanguageEntry.load", () => {
  /** A Lezer package resolves to a usable extension. */
  it("loads a Lezer language pack", async () => {
    const extension = await sourceLanguage("rs")?.load();
    expect(extension).toBeDefined();
  });

  /** The configured variant loads through the same package with its options applied. */
  it("loads a configured language variant", async () => {
    const extension = await sourceLanguage("tsx")?.load();
    expect(extension).toBeDefined();
  });

  /** A legacy stream mode resolves through StreamLanguage rather than a Lezer parser. */
  it("loads a legacy stream mode", async () => {
    const extension = await sourceLanguage("ps1")?.load();
    expect(extension).toBeDefined();
  });
});

describe("isSyntaxHighlightingEligible", () => {
  /** The threshold is "greater than", so a file exactly on it is still highlighted. */
  it("keeps files on the threshold eligible", () => {
    expect(isSyntaxHighlightingEligible({ byteSize: SYNTAX_LIMIT.byteSize, lineCount: 1 })).toBe(
      true,
    );
    expect(isSyntaxHighlightingEligible({ byteSize: 1n, lineCount: SYNTAX_LIMIT.lineCount })).toBe(
      true,
    );
  });

  /** Either dimension alone is enough to skip loading a language pack. */
  it("rejects files past either dimension", () => {
    expect(
      isSyntaxHighlightingEligible({ byteSize: SYNTAX_LIMIT.byteSize + 1n, lineCount: 1 }),
    ).toBe(false);
    expect(
      isSyntaxHighlightingEligible({ byteSize: 1n, lineCount: SYNTAX_LIMIT.lineCount + 1 }),
    ).toBe(false);
    expect(isSyntaxHighlightingEligible({ byteSize: 5_242_880n, lineCount: 40_000 })).toBe(false);
  });

  /** The exact FE-017 numbers are pinned so a refactor cannot silently move them. */
  it("pins the documented thresholds", () => {
    expect(SYNTAX_LIMIT.byteSize).toBe(2_097_152n);
    expect(SYNTAX_LIMIT.lineCount).toBe(20_000);
  });
});
