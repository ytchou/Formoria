import rawBannedTerms from "./banned-terms.json";

/**
 * Single source of truth for zh-TW vocabulary enforcement.
 *
 * The list itself lives in `banned-terms.json` so this module stays free of
 * Han characters and needs no entry in the hardcoded-CJK guard allowlist.
 *
 * Detection is report-only: `detectBannedTerms` never returns a modified
 * string. `fixBannedTerms` is the only function that rewrites text.
 */

export interface BannedTerm {
  /** The mainland-Chinese term that must not appear in stored or published text. */
  term: string;
  /** The Taiwan-Mandarin replacement. */
  replacement: string;
}

export interface BannedTermHit extends BannedTerm {
  /** Zero-based character offset of the match in the scanned string. */
  offset: number;
}

export interface BannedTermFixResult {
  text: string;
  substitutions: BannedTermHit[];
}

export const BANNED_TERMS: readonly BannedTerm[] =
  rawBannedTerms as BannedTerm[];

const BANNED_BY_TERM = new Map(
  BANNED_TERMS.map((entry) => [entry.term, entry] as const),
);

/**
 * Correct zh-TW words that literally contain a banned term (the replacement
 * for the banned term is the longer, correct word). Scanning consumes these
 * first so the shorter banned substring inside them is never flagged.
 *
 * Derived from the data, not hardcoded: any replacement that contains a banned
 * term and is not itself banned becomes a shield.
 */
const SHIELDS: string[] = Array.from(
  new Set(
    BANNED_TERMS.filter(
      (entry) =>
        !BANNED_BY_TERM.has(entry.replacement) &&
        BANNED_TERMS.some(
          (other) =>
            other.term !== entry.replacement &&
            entry.replacement.includes(other.term),
        ),
    ).map((entry) => entry.replacement),
  ),
);

/** Every scannable token, longest first, so a longer match always wins. */
const SCAN_TOKENS: string[] = [
  ...SHIELDS,
  ...BANNED_TERMS.map((entry) => entry.term),
].sort((a, b) => b.length - a.length);

/**
 * Report every banned term in `text`. Pure: the input is never modified.
 */
export function detectBannedTerms(text: string): BannedTermHit[] {
  if (!text) return [];

  const hits: BannedTermHit[] = [];
  let index = 0;

  while (index < text.length) {
    const token = SCAN_TOKENS.find((candidate) =>
      text.startsWith(candidate, index),
    );

    if (!token) {
      index += 1;
      continue;
    }

    const banned = BANNED_BY_TERM.get(token);
    if (banned) {
      hits.push({
        term: banned.term,
        replacement: banned.replacement,
        offset: index,
      });
    }

    index += token.length;
  }

  return hits;
}

/**
 * Replace every banned term with its zh-TW replacement.
 * Returns the rewritten text plus the substitutions that were applied.
 */
export function fixBannedTerms(text: string): BannedTermFixResult {
  const substitutions = detectBannedTerms(text);
  if (substitutions.length === 0) return { text, substitutions: [] };

  let out = "";
  let cursor = 0;

  for (const hit of substitutions) {
    out += text.slice(cursor, hit.offset) + hit.replacement;
    cursor = hit.offset + hit.term.length;
  }

  return { text: out + text.slice(cursor), substitutions };
}
