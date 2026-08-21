import { describe, expect, it } from "vitest";
import { parseBrandFactsResult } from "../brand-facts";
import { parseClassificationBatch } from "../enrich-phases/classify-images";
import { reportSummaryText } from "../enrich-phases/reputation";

/**
 * DEV-1546 write-path vocabulary REPORT for the three paths that had no
 * vocabulary enforcement at all after `localizeToTW` lost its substitution
 * table: brand facts, image alt text, and the reputation summary.
 *
 * All three are report-only. The text is stored exactly as the model wrote it,
 * and the finding lands on the enclosing phase's audit span as `bannedTerms` /
 * `bannedTermCount`. Rewriting is impossible to do safely on a script with no
 * word delimiters — 台南市保安路 and 質量輕的材料 are correct zh-TW that merely
 * contain a banned substring — so the backfill script, read by a human, stays
 * the only mutator.
 *
 * Tested at the parse/report entry points rather than by driving the phases:
 * every one of those phases reads Supabase, and `check:test-boundaries` forbids
 * mocking it. This follows `reputation.test.ts`, which tests
 * `resolveClearedFields` for the same reason.
 */

type Span = { summary: Record<string, unknown> };

const span = (): Span => ({ summary: {} });

/** The audit entries a span accumulated, in the shape the terminal row emits. */
function hits(ctx: Span): Array<Record<string, unknown>> {
  const recorded = ctx.summary.bannedTerms;
  return Array.isArray(recorded)
    ? (recorded as Array<Record<string, unknown>>)
    : [];
}

describe("brand facts listing reason", () => {
  const factsJson = (reason: string) =>
    JSON.stringify({
      listing: {
        verdict: "reject",
        reason,
        taiwan_connection: "unclear",
        has_own_products: false,
        has_purchase_channel: false,
      },
    });

  it("stores the reason unchanged and records the hit", () => {
    const ctx = span();
    const reason = "這個品牌只有視頻，沒有自有產品。";

    const result = parseBrandFactsResult(factsJson(reason), ctx);

    expect(result.listing?.reason).toBe(reason);
    expect(hits(ctx)).toEqual([
      {
        field: "listing_reason",
        term: "視頻",
        replacement: "影片",
        count: 1,
      },
    ]);
    expect(ctx.summary.bannedTermCount).toBe(1);
  });

  it("records nothing for clean text", () => {
    const ctx = span();
    const reason = "這個品牌沒有自有產品。";

    expect(parseBrandFactsResult(factsJson(reason), ctx).listing?.reason).toBe(
      reason,
    );
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it.each(["台南市保安路上的店面", "質量輕的材料無法佐證產地"])(
    "never rewrites the boundary false positive %s",
    (reason) => {
      expect(parseBrandFactsResult(factsJson(reason)).listing?.reason).toBe(
        reason,
      );
    },
  );
});

describe("image alt text", () => {
  const batch = (altZh: string) =>
    JSON.stringify([
      {
        id: "1",
        disposition: "keep",
        tag: "product",
        reasons: [],
        score: 90,
        alt_zh: altZh,
        alt_en: "A product photo",
      },
    ]);

  it("stores alt_zh unchanged and records the hit", () => {
    const ctx = span();
    const altZh = "產品視頻截圖";

    const verdicts = parseClassificationBatch(batch(altZh), ctx);

    expect(verdicts.get("1")?.altZh).toBe(altZh);
    expect(hits(ctx)).toEqual([
      {
        field: "alt_zh",
        term: "視頻",
        replacement: "影片",
        count: 1,
      },
    ]);
  });

  it("records nothing for clean alt text", () => {
    const ctx = span();
    const altZh = "產品影片截圖";

    expect(parseClassificationBatch(batch(altZh), ctx).get("1")?.altZh).toBe(
      altZh,
    );
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it("never rewrites a boundary false positive", () => {
    const altZh = "台南市保安路的店門口";
    expect(parseClassificationBatch(batch(altZh)).get("1")?.altZh).toBe(altZh);
  });
});

describe("reputation summary", () => {
  it("returns the summary unchanged and records the hit", () => {
    const ctx = span();
    const text = "媒體報導以視頻形式呈現。";

    expect(reportSummaryText(ctx, text)).toBe(text);
    expect(hits(ctx)).toEqual([
      {
        field: "reputation_summary",
        term: "視頻",
        replacement: "影片",
        count: 1,
      },
    ]);
    expect(ctx.summary.bannedTermCount).toBe(1);
  });

  it("records nothing for clean text", () => {
    const ctx = span();
    const text = "媒體報導以影片形式呈現。";

    expect(reportSummaryText(ctx, text)).toBe(text);
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it("never rewrites a boundary false positive", () => {
    const ctx = span();
    const text = "報導提到質量輕的材料與台南市保安路的門市。";
    expect(reportSummaryText(ctx, text)).toBe(text);
  });
});
