import rawBannedTerms from "./banned-terms.json";

/**
 * Single source of truth for zh-TW vocabulary enforcement.
 *
 * The list itself lives in `banned-terms.json` so this module stays free of
 * Han characters and needs no entry in the hardcoded-CJK guard allowlist.
 *
 * Detection is report-only: `detectBannedTerms` never returns a modified
 * string. `fixBannedTerms` is the only function that rewrites text, and the
 * only caller allowed to rewrite is the backfill script, where a human reads
 * the diff before it lands (DEV-1546). Every WRITE path uses `reportBannedTerms`
 * and stores exactly what the model wrote: this script has no word delimiters,
 * so substring matching cannot tell a banned term from a correct word, a street
 * name, or a proper noun that merely contains one.
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
 * Case-folded lookup, so a Latin-script term matched in any casing still
 * resolves to its canonical entry. Lowercasing is identity for Han, so this map
 * has exactly the same keys as `BANNED_BY_TERM` apart from the Latin ones.
 */
const BANNED_BY_FOLDED_TERM = new Map(
  BANNED_TERMS.map((entry) => [entry.term.toLowerCase(), entry] as const),
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
        BANNED_TERMS.some((other) => entry.replacement.includes(other.term)),
    ).map((entry) => entry.replacement),
  ),
);

/** Every scannable token, longest first, so a longer match always wins. */
const SCAN_TOKENS: string[] = [
  ...SHIELDS,
  ...BANNED_TERMS.map((entry) => entry.term),
].sort((a, b) => b.length - a.length);

/** Printable ASCII only — the tests for "is this a Latin-script term". */
const ASCII_ONLY = /^[\x20-\x7e]+$/;

/** The list is DATA. A metacharacter in a term must match itself, not compile. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One token as a regex fragment.
 *
 * Latin-script tokens fold case per character (`[Yy][Yy][Dd][Ss]`) rather than
 * riding an `i` flag on the whole alternation: `i` would also apply Unicode
 * case folding to the Han tokens, where case does not exist and folding can
 * only introduce surprises. Han tokens stay byte-exact.
 */
function tokenPattern(token: string): string {
  if (!ASCII_ONLY.test(token)) return escapeRegExp(token);
  return [...token]
    .map((char) => {
      const lower = char.toLowerCase();
      const upper = char.toUpperCase();
      return lower === upper
        ? escapeRegExp(char)
        : `[${escapeRegExp(lower)}${escapeRegExp(upper)}]`;
    })
    .join("");
}

/**
 * One precompiled alternation over every scannable token.
 *
 * Regex alternation returns the FIRST alternative that matches at a position,
 * and `SCAN_TOKENS` is already sorted longest-first — so longest-match wins
 * exactly as the previous hand-rolled cursor loop made it, shields included,
 * at one pass over the string instead of one probe per token per character.
 */
const SCAN_PATTERN = new RegExp(SCAN_TOKENS.map(tokenPattern).join("|"), "g");

/**
 * Report every banned term in `text`. Pure: the input is never modified.
 */
export function detectBannedTerms(text: string): BannedTermHit[] {
  if (!text) return [];

  const hits: BannedTermHit[] = [];
  SCAN_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SCAN_PATTERN.exec(text)) !== null) {
    // A shield matched here consumes its span and reports nothing, which is the
    // whole point of scanning it: the banned substring inside it is now past.
    const banned = BANNED_BY_FOLDED_TERM.get(match[0].toLowerCase());
    if (!banned) continue;
    hits.push({
      term: banned.term,
      replacement: banned.replacement,
      offset: match.index,
    });
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

/**
 * One banned term corrected inside one named database column.
 *
 * `field` is the column name, not a label: the point of the audit entry is that
 * a reader can tell WHICH stored column a term was found in without re-reading
 * the row.
 */
export interface BannedTermFieldFix {
  /** The database column the term was corrected in (snake_case). */
  field: string;
  term: string;
  replacement: string;
  /** How many occurrences of `term` were replaced in that field. */
  count: number;
}

/** Collapse per-occurrence fixes into one entry per (field, term) pair. */
export function mergeBannedTermFixes(
  fixes: readonly BannedTermFieldFix[],
): BannedTermFieldFix[] {
  const merged = new Map<string, BannedTermFieldFix>();
  for (const fix of fixes) {
    const key = `${fix.field} ${fix.term}`;
    const existing = merged.get(key);
    if (existing) existing.count += fix.count;
    else merged.set(key, { ...fix });
  }
  return [...merged.values()];
}

/**
 * Correct one field's text and report what was corrected, tagged with the
 * column it came from.
 *
 * Clean text is returned BY REFERENCE — `fixBannedTerms` hands back the input
 * string untouched when nothing matched — so a caller can assign the result
 * back unconditionally and still produce a byte-identical payload.
 */
export function fixBannedTermsInField(
  field: string,
  value: string,
): { value: string; fixes: BannedTermFieldFix[] } {
  const { text, substitutions } = fixBannedTerms(value);
  if (substitutions.length === 0) return { value, fixes: [] };
  return {
    value: text,
    fixes: mergeBannedTermFixes(
      substitutions.map((hit) => ({
        field,
        term: hit.term,
        replacement: hit.replacement,
        count: 1,
      })),
    ),
  };
}

/**
 * One banned term FOUND inside one named database column.
 *
 * Structurally identical to `BannedTermFieldFix`, and deliberately so: the
 * write paths no longer rewrite anything, but `replacement` stays in the audit
 * entry because it is the suggestion a human acts on when they read the span
 * (or when the backfill script proposes its diff).
 */
export type BannedTermFieldHit = BannedTermFieldFix;

/** Collapse per-occurrence hits into one entry per (field, term) pair. */
export const mergeBannedTermHits = mergeBannedTermFixes;

/**
 * Report one field's banned terms, tagged with the column they came from.
 *
 * Pure and report-only: nothing is rewritten, so the caller's value is stored
 * byte-identical to what the model wrote. Substring matching cannot be made
 * safe on a script with no word delimiters — a correct Taiwan-Mandarin word,
 * a street name, or a proper noun can contain a banned term outright — so
 * rewriting is left to the backfill script, where a human reads the diff.
 */
export function detectBannedTermsInField(
  field: string,
  value: string,
): BannedTermFieldHit[] {
  const hits = detectBannedTerms(value);
  if (hits.length === 0) return [];
  return mergeBannedTermHits(
    hits.map((hit) => ({
      field,
      term: hit.term,
      replacement: hit.replacement,
      count: 1,
    })),
  );
}

/** A database column paired with the value about to be stored in it. */
export type BannedTermScanField = readonly [field: string, value: unknown];

/**
 * THE write-path vocabulary guard. Every write path uses this one helper.
 *
 * Scans the supplied columns, leaves every value untouched, and records what
 * was found on the enclosing audit span as `bannedTerms` / `bannedTermCount`.
 * Non-string and empty values are skipped. Clean text records nothing at all,
 * so an absent `bannedTermCount` means "scanned, nothing found".
 *
 * Repeated calls on one span ACCUMULATE: a phase that writes many rows (images,
 * FAQ entries) reports one merged entry per (field, term) across all of them.
 */
export function reportBannedTerms(
  ctx: { summary: Record<string, unknown> },
  fields: readonly BannedTermScanField[],
): BannedTermFieldHit[] {
  const hits = fields.flatMap(([field, value]) =>
    typeof value === "string" && value.length > 0
      ? detectBannedTermsInField(field, value)
      : [],
  );
  if (hits.length === 0) {
    const current = ctx.summary.bannedTerms;
    return Array.isArray(current) ? (current as BannedTermFieldHit[]) : [];
  }

  const existing = Array.isArray(ctx.summary.bannedTerms)
    ? (ctx.summary.bannedTerms as BannedTermFieldHit[])
    : [];
  const merged = mergeBannedTermHits([...existing, ...hits]);
  ctx.summary.bannedTerms = merged;
  ctx.summary.bannedTermCount = merged.reduce(
    (total, hit) => total + hit.count,
    0,
  );
  return merged;
}
