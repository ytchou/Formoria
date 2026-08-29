import { createServiceClient } from "@/lib/supabase/service";

/**
 * The reader for the zh-TW vocabulary audit trail (DEV-1547 E3).
 *
 * `reportBannedTerms` (src/lib/i18n/banned-terms.ts) is the write-path guard:
 * since DEV-1546 it detects a mainland-Chinese term in text about to be stored
 * and RECORDS it on the enclosing audit span as `summary.bannedTerms` /
 * `summary.bannedTermCount`, without changing a character. Substring matching
 * has no word boundaries in Chinese, so a mutating guard corrupted correct
 * Taiwanese words and proper nouns; report-only is the settled answer.
 *
 * But nothing read those fields. A term that reached `brand_faq_entries` was
 * published on the brand page, and its only
 * trace was a JSON blob in a table nobody queries — "detect and audit" with no
 * audience is a weaker promise than the "detect and fix" it replaced. This
 * module is the audience.
 *
 * WHY A DASHBOARD SECTION, and not the other three options the ticket lists:
 *
 *   - blocking the write is the mutation debate again in a new costume: the
 *     matcher cannot tell a Tainan street name containing a banned substring
 *     from a real error, so a block would reject correct text and put an
 *     enrichment run on the floor;
 *   - an alert needs a threshold, and one hit is neither a page nor nothing —
 *     the honest reading of a hit is "a human should look", which is a queue;
 *   - a health-agent detector is the right long-term home, but it is the
 *     heaviest: a cron endpoint, ~250 lines of collector wiring in
 *     `workflow-runtime.ts`, a merge into `directory-health.json` and a finding
 *     ceiling, for a signal with no established rate. The shape below is one
 *     query, and `loadZhVocabularyReport` is exactly the summary such a
 *     detector would later fetch — so that upgrade adds a route and a collector
 *     and changes nothing here.
 *
 * REPORT ONLY, exactly like `trail-supply-report.ts`, whose shape this follows:
 * nothing on a public surface changes because of a finding, no row is rewritten,
 * and `readUnavailable` distinguishes "looked, found nothing" from "could not
 * look" so a dormant deployment never reads as a clean one.
 *
 * This file names no Chinese term: the terms come from the rows at runtime, and
 * the list itself lives in `banned-terms.json` so no source file under `src/`
 * has to carry Han characters (the hardcoded-CJK guard scans comments too).
 */

/** How far back the dashboard looks. */
export const ZH_VOCABULARY_WINDOW_DAYS = 30;

/**
 * The span cap.
 *
 * The predicate is a jsonb key test with no index behind it, so the read is
 * bounded by the window and this cap rather than by the planner. Hits are rare
 * by construction (the whole point is that they should be near zero), so a cap
 * this far above any healthy value only bites when something is very wrong —
 * and `spansObserved === ZH_VOCABULARY_MAX_SPANS` is itself the signal that the
 * true number is higher.
 *
 * CEILING: if hits ever become routine, add a partial index on
 * `(created_at) where summary ? 'bannedTermCount'` before raising this.
 */
export const ZH_VOCABULARY_MAX_SPANS = 200;

/** How many individual spans the report carries back for context. */
const MAX_RECENT_SPANS = 20;

/** One (column, term) pair, summed over every span in the window. */
type ZhVocabularyFieldHit = {
  /** The database column the term was found in (snake_case). */
  field: string;
  term: string;
  /** The Taiwan-Mandarin word a human would put there instead. */
  replacement: string;
  count: number;
};

/** One audited write that carried at least one hit. */
type ZhVocabularySpan = {
  observedAt: string;
  provider: string;
  operation: string;
  /** The brand or row the write was about, when the span recorded one. */
  subjectId: string | null;
  hits: number;
};

/**
 * `readUnavailable` is load-bearing and mirrors `TrailSupplyReport`: `true`
 * means the query did not run, and every count below is meaningless rather than
 * clean.
 */
export type ZhVocabularyReport = {
  readUnavailable: boolean;
  windowDays: number;
  /** Audited writes that carried at least one hit, capped. */
  spansObserved: number;
  /** Total term occurrences across those spans. */
  totalHits: number;
  /** Descending by count: what to fix first. */
  byField: ZhVocabularyFieldHit[];
  recentSpans: ZhVocabularySpan[];
};

/** The slice of PostgREST this read uses, declared structurally. */
type ZhVocabularyQuery = {
  select(columns: string): ZhVocabularyQuery;
  gte(column: string, value: string): ZhVocabularyQuery;
  not(column: string, operator: string, value: unknown): ZhVocabularyQuery;
  order(column: string, options: { ascending: boolean }): ZhVocabularyQuery;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

export type ZhVocabularyClient = {
  from(table: string): ZhVocabularyQuery;
};

/**
 * A FACTORY, not a client: `createServiceClient()` reads env at call time and
 * must not run at module load. Same reason as `TrailSupplyReportDeps`.
 */
export type ZhVocabularyReportDeps = {
  client: () => ZhVocabularyClient;
  now?: () => Date;
};

const PRODUCTION_DEPS: ZhVocabularyReportDeps = {
  client: () => createServiceClient() as unknown as ZhVocabularyClient,
};

function emptyReport(readUnavailable: boolean): ZhVocabularyReport {
  return {
    readUnavailable,
    windowDays: ZH_VOCABULARY_WINDOW_DAYS,
    spansObserved: 0,
    totalHits: 0,
    byField: [],
    recentSpans: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Read one span's `summary.bannedTerms`.
 *
 * The column is `Json`, written by a previous deployment of a different module,
 * so every field is validated rather than cast. A summary whose shape does not
 * match contributes nothing instead of throwing: one malformed historical row
 * must not blank the whole dashboard section.
 */
function readSpanHits(summary: unknown): ZhVocabularyFieldHit[] {
  const record = asRecord(summary);
  if (!record || !Array.isArray(record.bannedTerms)) return [];

  const hits: ZhVocabularyFieldHit[] = [];
  for (const entry of record.bannedTerms) {
    const hit = asRecord(entry);
    if (!hit) continue;
    const { field, term, replacement, count } = hit;
    if (typeof field !== "string" || typeof term !== "string") continue;
    hits.push({
      field,
      term,
      replacement: asText(replacement, ""),
      count: typeof count === "number" && count > 0 ? count : 1,
    });
  }
  return hits;
}

/**
 * What the write-path guard has found recently, aggregated for a human.
 *
 * Never throws: a failed read returns `readUnavailable: true`, because this is
 * one section of an admin page and a vocabulary query must not be able to take
 * the quality dashboard down.
 */
export async function loadZhVocabularyReport(
  deps: ZhVocabularyReportDeps = PRODUCTION_DEPS,
): Promise<ZhVocabularyReport> {
  const now = deps.now?.() ?? new Date();
  const since = new Date(
    now.getTime() - ZH_VOCABULARY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let rows: Record<string, unknown>[];
  try {
    const { data, error } = await deps
      .client()
      .from("external_call_audit")
      .select("created_at, provider, operation, subject_id, summary")
      .gte("created_at", since)
      // `->>` rather than `->`: the text form of the key is what PostgREST
      // compares against null reliably, and the value itself is not read here.
      .not("summary->>bannedTermCount", "is", null)
      .order("created_at", { ascending: false })
      .limit(ZH_VOCABULARY_MAX_SPANS);
    if (error) return emptyReport(true);
    rows = (data ?? []).flatMap((row) => {
      const record = asRecord(row);
      return record ? [record] : [];
    });
  } catch {
    return emptyReport(true);
  }

  const byField = new Map<string, ZhVocabularyFieldHit>();
  const recentSpans: ZhVocabularySpan[] = [];
  let totalHits = 0;

  for (const row of rows) {
    const hits = readSpanHits(row.summary);
    if (hits.length === 0) continue;

    let spanHits = 0;
    for (const hit of hits) {
      spanHits += hit.count;
      const key = `${hit.field} ${hit.term}`;
      const existing = byField.get(key);
      if (existing) existing.count += hit.count;
      else byField.set(key, { ...hit });
    }
    totalHits += spanHits;

    if (recentSpans.length < MAX_RECENT_SPANS) {
      recentSpans.push({
        observedAt: asText(row.created_at, ""),
        provider: asText(row.provider, "unknown"),
        operation: asText(row.operation, "unknown"),
        subjectId: typeof row.subject_id === "string" ? row.subject_id : null,
        hits: spanHits,
      });
    }
  }

  return {
    readUnavailable: false,
    windowDays: ZH_VOCABULARY_WINDOW_DAYS,
    spansObserved: rows.length,
    totalHits,
    byField: [...byField.values()].sort((a, b) => b.count - a.count),
    recentSpans,
  };
}
