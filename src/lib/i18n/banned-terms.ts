import type { AuditCallContext } from "@/lib/audit";

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

/** One mainland-Chinese term and the Taiwan-Mandarin word that replaces it. */
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
 * One banned term FOUND inside one named database column.
 *
 * `field` is the column name, not a label: the point of the audit entry is that
 * a reader can tell WHICH stored column a term was found in without re-reading
 * the row. `replacement` is carried even though nothing on the write path
 * rewrites anything, because it is the suggestion a human acts on when they
 * read the span (or when the backfill script proposes its diff).
 */
export interface BannedTermFieldHit {
  /** The database column the term was found in (snake_case). */
  field: string;
  term: string;
  replacement: string;
  /** How many occurrences of `term` were found in that field. */
  count: number;
}

/** A database column paired with the value about to be stored in it. */
export type BannedTermScanField = readonly [field: string, value: unknown];

/**
 * One span's accumulated hits, kept as a Map beside the array so a repeated
 * call costs one lookup per NEW hit rather than a re-merge of everything found
 * so far.
 */
type HitIndex = {
  entries: Map<string, BannedTermFieldHit>;
  /** The exact array published on `summary.bannedTerms`, mutated in place. */
  list: BannedTermFieldHit[];
  /** Running sum of `count` across `list`. */
  total: number;
};

function newHitIndex(): HitIndex {
  return { entries: new Map(), list: [], total: 0 };
}

function addHit(index: HitIndex, hit: BannedTermFieldHit): void {
  const key = `${hit.field} ${hit.term}`;
  const existing = index.entries.get(key);
  index.total += hit.count;
  if (existing) {
    existing.count += hit.count;
    return;
  }
  const entry = { ...hit };
  index.entries.set(key, entry);
  index.list.push(entry);
}

/**
 * Accumulation index per span, held OUTSIDE `ctx.summary`.
 *
 * The summary is serialized onto the audit row, so a Map stored there would
 * emit as `{}`. Keeping it here makes accumulation incremental: the previous
 * shape spread the whole accumulated list into a fresh merge on every call, so
 * a brand with N hit-carrying images did O(N^2) merge work and allocated N
 * copies of the full list.
 */
const HIT_INDEX = new WeakMap<Record<string, unknown>, HitIndex>();

function hitIndexFor(summary: Record<string, unknown>): HitIndex {
  const cached = HIT_INDEX.get(summary);
  // The cached index is only valid while it still describes the array actually
  // published on the summary. Anything else (a fresh span, or a caller that
  // replaced `bannedTerms` outright) rebuilds from what is really there.
  if (cached && summary.bannedTerms === cached.list) return cached;

  const index = newHitIndex();
  if (Array.isArray(summary.bannedTerms)) {
    for (const hit of summary.bannedTerms as BannedTermFieldHit[]) {
      addHit(index, hit);
    }
  }
  HIT_INDEX.set(summary, index);
  return index;
}

/**
 * THE write-path vocabulary guard. Every write path uses this one helper.
 *
 * Scans the supplied columns, leaves every value untouched, and records what
 * was found on the enclosing audit span as `bannedTerms` / `bannedTermCount`.
 * Non-string and empty values are skipped. Clean text records nothing at all,
 * so an absent `bannedTermCount` means "scanned, nothing found".
 *
 * `ctx` is REQUIRED, and deliberately: while it was optional, dropping the
 * threaded argument at a call site still compiled, linted, and passed the whole
 * suite with detection silently off — which is the exact ambiguity this
 * function claims to resolve.
 *
 * Repeated calls on one span ACCUMULATE: a phase that writes many rows (images,
 * FAQ entries) reports one merged entry per (field, term) across all of them.
 */
export function reportBannedTerms(
  ctx: AuditCallContext,
  fields: readonly BannedTermScanField[],
): BannedTermFieldHit[] {
  const index = hitIndexFor(ctx.summary);
  let added = 0;

  for (const [field, value] of fields) {
    if (typeof value !== "string" || value.length === 0) continue;
    for (const hit of detectBannedTerms(value)) {
      addHit(index, {
        field,
        term: hit.term,
        replacement: hit.replacement,
        count: 1,
      });
      added += 1;
    }
  }

  if (added === 0) return index.list;

  ctx.summary.bannedTerms = index.list;
  ctx.summary.bannedTermCount = index.total;
  return index.list;
}
