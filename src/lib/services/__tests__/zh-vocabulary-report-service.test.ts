import { describe, expect, it } from "vitest";

import {
  ZH_VOCABULARY_MAX_SPANS,
  ZH_VOCABULARY_WINDOW_DAYS,
  loadZhVocabularyReport,
  type ZhVocabularyClient,
} from "@/lib/services/zh-vocabulary-report";

/**
 * DEV-1547 E3. `reportBannedTerms` has written `summary.bannedTerms` on every
 * audited write since DEV-1546 and nothing read it. These tests pin the reader:
 * what it asks the database for, what it makes of a summary written by another
 * module, and that a failed read is never presented as a clean one.
 *
 * The neighbouring `zh-vocabulary-report.test.ts` is the WRITE side of the same
 * signal — it proves brand facts and image alt text still report onto their
 * span. This file is the READ side, and the two are named apart rather than
 * merged because they share a subject and nothing else.
 */

type QueryCall = {
  table: string;
  columns: string;
  gte: [string, string][];
  not: [string, string, unknown][];
  order: [string, boolean][];
  limit: number | null;
};

function fakeClient(
  rows: unknown[] | { error: unknown },
  call: QueryCall,
): ZhVocabularyClient {
  const query = {
    select: (columns: string) => {
      call.columns = columns;
      return query;
    },
    gte: (column: string, value: string) => {
      call.gte.push([column, value]);
      return query;
    },
    not: (column: string, operator: string, value: unknown) => {
      call.not.push([column, operator, value]);
      return query;
    },
    order: (column: string, options: { ascending: boolean }) => {
      call.order.push([column, options.ascending]);
      return query;
    },
    limit: async (count: number) => {
      call.limit = count;
      return Array.isArray(rows)
        ? { data: rows, error: null }
        : { data: null, error: rows.error };
    },
  };

  return {
    from: (table: string) => {
      call.table = table;
      return query;
    },
  };
}

function emptyCall(): QueryCall {
  return {
    table: "",
    columns: "",
    gte: [],
    not: [],
    order: [],
    limit: null,
  };
}

const NOW = new Date("2026-08-21T12:00:00.000Z");

function span(summary: unknown, overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-08-20T09:00:00.000Z",
    provider: "deepseek",
    operation: "enrich_brand",
    subject_id: "brand-1",
    summary,
    ...overrides,
  };
}

/** A summary in the exact shape `reportBannedTerms` publishes. */
function summaryWith(
  hits: { field: string; term: string; replacement: string; count: number }[],
) {
  return {
    bannedTerms: hits,
    bannedTermCount: hits.reduce((total, hit) => total + hit.count, 0),
  };
}

describe("loadZhVocabularyReport", () => {
  it("asks only for spans that carry a hit, inside the window", async () => {
    const call = emptyCall();
    await loadZhVocabularyReport({
      client: () => fakeClient([], call),
      now: () => NOW,
    });

    expect(call.table).toBe("external_call_audit");
    // The filter is what keeps this off a full scan of the audit table.
    expect(call.not).toEqual([["summary->>bannedTermCount", "is", null]]);
    expect(call.gte).toEqual([
      [
        "created_at",
        new Date(
          NOW.getTime() - ZH_VOCABULARY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      ],
    ]);
    expect(call.order).toEqual([["created_at", false]]);
    expect(call.limit).toBe(ZH_VOCABULARY_MAX_SPANS);
    // The service-role key must never ride into a report; only these columns.
    expect(call.columns).toBe(
      "created_at, provider, operation, subject_id, summary",
    );
  });

  it("merges hits across spans into one row per field and term", async () => {
    const call = emptyCall();
    const report = await loadZhVocabularyReport({
      client: () =>
        fakeClient(
          [
            span(
              summaryWith([
                {
                  field: "answer_zh",
                  term: "視頻",
                  replacement: "影片",
                  count: 2,
                },
                {
                  field: "alt_zh",
                  term: "信息",
                  replacement: "資訊",
                  count: 1,
                },
              ]),
            ),
            span(
              summaryWith([
                {
                  field: "answer_zh",
                  term: "視頻",
                  replacement: "影片",
                  count: 3,
                },
              ]),
              { subject_id: "brand-2" },
            ),
          ],
          call,
        ),
      now: () => NOW,
    });

    expect(report.readUnavailable).toBe(false);
    expect(report.spansObserved).toBe(2);
    expect(report.totalHits).toBe(6);
    // Descending by count: the founder reads the top row first.
    expect(report.byField).toEqual([
      { field: "answer_zh", term: "視頻", replacement: "影片", count: 5 },
      { field: "alt_zh", term: "信息", replacement: "資訊", count: 1 },
    ]);
    expect(report.recentSpans).toEqual([
      {
        observedAt: "2026-08-20T09:00:00.000Z",
        provider: "deepseek",
        operation: "enrich_brand",
        subjectId: "brand-1",
        hits: 3,
      },
      {
        observedAt: "2026-08-20T09:00:00.000Z",
        provider: "deepseek",
        operation: "enrich_brand",
        subjectId: "brand-2",
        hits: 3,
      },
    ]);
  });

  it("survives a summary written in a shape it does not recognise", async () => {
    // The column is `Json`, written by another module in an earlier deployment.
    // One malformed historical row must not blank the whole section.
    const call = emptyCall();
    const report = await loadZhVocabularyReport({
      client: () =>
        fakeClient(
          [
            span({ bannedTerms: "not an array", bannedTermCount: 4 }),
            span({ bannedTerms: [{ field: 42 }] }),
            span(null),
            span(
              summaryWith([
                { field: "blurb", term: "質量", replacement: "品質", count: 1 },
              ]),
            ),
          ],
          call,
        ),
      now: () => NOW,
    });

    expect(report.totalHits).toBe(1);
    expect(report.byField).toEqual([
      { field: "blurb", term: "質量", replacement: "品質", count: 1 },
    ]);
    // Every row the query returned is still counted as observed; only the hits
    // are dropped, so a wave of unreadable summaries is visible as the gap.
    expect(report.spansObserved).toBe(4);
    expect(report.recentSpans).toHaveLength(1);
  });

  it("reports a failed read as unavailable, never as clean", async () => {
    const call = emptyCall();
    const report = await loadZhVocabularyReport({
      client: () => fakeClient({ error: { code: "42501" } }, call),
      now: () => NOW,
    });

    expect(report.readUnavailable).toBe(true);
    expect(report.totalHits).toBe(0);
    expect(report.byField).toEqual([]);
  });

  it("reports a thrown client as unavailable too", async () => {
    const report = await loadZhVocabularyReport({
      client: () => {
        throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");
      },
      now: () => NOW,
    });

    expect(report.readUnavailable).toBe(true);
  });

  it("says nothing was found when the window is genuinely clean", async () => {
    const call = emptyCall();
    const report = await loadZhVocabularyReport({
      client: () => fakeClient([], call),
      now: () => NOW,
    });

    expect(report).toEqual({
      readUnavailable: false,
      windowDays: ZH_VOCABULARY_WINDOW_DAYS,
      spansObserved: 0,
      totalHits: 0,
      byField: [],
      recentSpans: [],
    });
  });
});
