/**
 * BE-005 revision arithmetic, shared by every independent reader of `sessions://runtime-changed`.
 *
 * A revision is a `u64` serialized as a decimal string. It is never converted to a JavaScript
 * `number`, because values above `Number.MAX_SAFE_INTEGER` would silently lose precision and
 * make two different revisions compare equal. All comparisons stay string arithmetic.
 */

/** Strip leading zeros so two decimal revisions can be compared by length first. */
function normalizeRevision(revision: string): string {
  const trimmed = revision.replace(/^0+/, "");
  return trimmed === "" ? "0" : trimmed;
}

/**
 * Order two revisions as non-negative integers: a longer normalized string is always the
 * larger value, and equal lengths compare lexically.
 */
export function compareSessionRevisions(left: string, right: string): number {
  const a = normalizeRevision(left);
  const b = normalizeRevision(right);

  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }

  return a === b ? 0 : a < b ? -1 : 1;
}

/** Add one to a decimal revision without ever leaving string arithmetic. */
export function nextSessionRevision(revision: string): string {
  const digits = Array.from(normalizeRevision(revision));
  let index = digits.length - 1;

  while (index >= 0) {
    const digit = Number(digits[index]);
    if (digit < 9) {
      digits[index] = String(digit + 1);
      return digits.join("");
    }
    digits[index] = "0";
    index -= 1;
  }

  return `1${digits.join("")}`;
}

/**
 * Decide how one incoming revision relates to the revision already applied.
 *
 * - `stale` — at or below what is applied, so the delivery is a duplicate or reordered.
 * - `next` — exactly one step ahead, so the event can be applied directly.
 * - `gap` — further ahead, so at least one event was missed and the reader must re-read.
 */
export function classifySessionRevision(
  applied: string,
  incoming: string,
): "stale" | "next" | "gap" {
  if (compareSessionRevisions(incoming, applied) <= 0) {
    return "stale";
  }

  return normalizeRevision(incoming) === nextSessionRevision(applied) ? "next" : "gap";
}
