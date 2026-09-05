/** One query match in a complete retained visual row. */
export interface TerminalSearchMatch {
  row: number;
  column: number;
  length: number;
}

/** Scheduler seam that lets long scans yield between bounded row batches. */
export type SearchYield = () => Promise<void>;

/** Yields one task so output and a changed query can be processed. */
export function yieldSearch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Finds literal case-sensitive matches without ever joining adjacent visual rows. */
export async function findTerminalMatches(
  rows: readonly string[],
  query: string,
  isCurrent: () => boolean = () => true,
  yieldNow: SearchYield = yieldSearch,
): Promise<TerminalSearchMatch[]> {
  if (query === "") return [];
  const needle = query;
  const matches: TerminalSearchMatch[] = [];
  let sliceStartedAt = performance.now();
  for (let row = 0; row < rows.length; row += 1) {
    if (!isCurrent()) return [];
    const haystack = rows[row] ?? "";
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const column = haystack.indexOf(needle, from);
      if (column < 0) break;
      matches.push({ row, column, length: query.length });
      from = column + Math.max(1, needle.length);
    }
    if (row > 0 && (row % 128 === 0 || performance.now() - sliceStartedAt >= 8)) {
      await yieldNow();
      sliceStartedAt = performance.now();
    }
  }
  return isCurrent() ? matches : [];
}

/** Finds safe plain-text web-link candidates and trims unmatched trailing punctuation. */
export function findPlainWebLinks(text: string): string[] {
  const candidates = text.match(/https?:\/\/\S+/giu) ?? [];
  return candidates
    .map(truncateAtControl)
    .map(trimLinkPunctuation)
    .filter((url) => url.length > 0);
}

/** Stops one broad non-whitespace candidate at the first ASCII control character. */
function truncateAtControl(candidate: string): string {
  const index = [...candidate].findIndex(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  return index < 0 ? candidate : [...candidate].slice(0, index).join("");
}

/** Removes prose punctuation and unmatched closing delimiters from one URL candidate. */
function trimLinkPunctuation(candidate: string): string {
  let value = candidate.replace(/[.,;!?]+$/u, "");
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  for (const [open, close] of pairs) {
    while (value.endsWith(close) && count(value, close) > count(value, open)) {
      value = value.slice(0, -1);
    }
  }
  return value;
}

/** Counts one delimiter without regular-expression escaping concerns. */
function count(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}
