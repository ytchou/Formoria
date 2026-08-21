import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCallContext } from "@/lib/audit";
import { extractBrandFacts, parseBrandFactsResult } from "../brand-facts";
import {
  parseClassificationBatch,
  planChunkImageWrites,
} from "../enrich-phases/classify-images";

/**
 * DEV-1546 write-path vocabulary REPORT for the paths that had no vocabulary
 * enforcement at all after `localizeToTW` lost its substitution table: brand
 * facts and image alt text.
 *
 * All of them are report-only. The text is stored exactly as the model wrote
 * it, and the finding lands on the enclosing phase's audit span as
 * `bannedTerms` / `bannedTermCount`. Rewriting is impossible to do safely on a
 * script with no word delimiters — 台南市保安路 and 質量輕的材料 are correct
 * zh-TW that merely contain a banned substring — so the backfill script, read
 * by a human, stays the only mutator.
 *
 * Tested at the seams that decide what is STORED, not at the parsers: a parsed
 * verdict for an image whose bytes never loaded is discarded before any write,
 * and a discarded retry attempt is never stored at all. Reporting either would
 * send an operator looking for a row that does not exist.
 */

const span = (): AuditCallContext => ({ summary: {} });

/** The audit entries a span accumulated, in the shape the terminal row emits. */
function hits(ctx: AuditCallContext): Array<Record<string, unknown>> {
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

  /**
   * Driven through the REAL `extractBrandFacts`, fetch stubbed at the boundary
   * the way `openai-client.test.ts` does it. The point is the wiring, not the
   * scan: the span argument used to be optional, and deleting it from this one
   * call site compiled, linted, and passed the whole suite with detection off.
   * These tests fail if it stops being passed.
   */
  let sinkDir: string;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    // The one write no `dryRun` branch suppresses. Diverted to a scratch file
    // so a unit test never inserts a `brand_ai_results` row.
    sinkDir = mkdtempSync(join(tmpdir(), "zh-vocab-"));
    process.env.CURATION_EVAL_SINK = join(sinkDir, "usage.jsonl");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CURATION_EVAL_SINK;
    rmSync(sinkDir, { recursive: true, force: true });
  });

  function stubResponses(...bodies: string[]) {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const content of bodies) {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content } }] })),
      );
    }
    return fetchSpy;
  }

  const audit = { target: { type: "brand", id: "brand-1" } } as const;

  it("stores the reason unchanged and records the hit", async () => {
    const ctx = span();
    const reason = "這個品牌只有視頻，沒有自有產品。";
    stubResponses(factsJson(reason));

    const output = await extractBrandFacts("品牌", "site text", audit, ctx);

    expect(output?.result?.listing?.reason).toBe(reason);
    expect(hits(ctx)).toEqual([
      {
        field: "non_brand_reason",
        term: "視頻",
        replacement: "影片",
        count: 1,
      },
    ]);
    expect(ctx.summary.bannedTermCount).toBe(1);
  });

  it("records nothing for a superseded attempt the retry replaced", async () => {
    const ctx = span();
    const clean = "這個品牌沒有自有產品。";
    // Attempt 1 is unparseable AND carries a banned term; attempt 2 is what is
    // stored. Reporting attempt 1 would name a term no row contains.
    const fetchSpy = stubResponses(
      "這是說明文字，不是 JSON：視頻很多。",
      factsJson(clean),
    );

    const output = await extractBrandFacts("品牌", "site text", audit, ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(output?.result?.listing?.reason).toBe(clean);
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it("records nothing for clean text", async () => {
    const ctx = span();
    const reason = "這個品牌沒有自有產品。";
    stubResponses(factsJson(reason));

    const output = await extractBrandFacts("品牌", "site text", audit, ctx);

    expect(output?.result?.listing?.reason).toBe(reason);
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
  const now = "2026-08-07T00:00:00.000Z";

  const image = (id: string) => ({
    id,
    url: `https://example.supabase.co/storage/v1/object/public/brand-images/brands/${id}.jpg`,
    storage_path: `brands/${id}.jpg`,
    width: 1200,
    height: 800,
  });

  /** A keep verdict built through the parser the phase actually uses. */
  const verdict = (altZh: string) =>
    parseClassificationBatch(
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
      ]),
    ).get("1")!;

  it("stores alt_zh unchanged and records the hit", () => {
    const ctx = span();
    const altZh = "產品視頻截圖";

    const plan = planChunkImageWrites({
      chunk: [image("a")],
      verdictsByImageId: new Map([["a", verdict(altZh)]]),
      unavailableIds: [],
      now,
      ctx,
    });

    expect(plan.writes[0]?.row.alt_zh).toBe(altZh);
    expect(hits(ctx)).toEqual([
      {
        field: "alt_zh",
        term: "視頻",
        replacement: "影片",
        count: 1,
      },
    ]);
  });

  it("records nothing for an image whose row is never written", () => {
    // The parse still yields a verdict for every slot the model echoed, so this
    // fails the moment reporting moves back onto the parse: the audit would
    // name a term that reached no row at all.
    const ctx = span();

    const plan = planChunkImageWrites({
      chunk: [image("unloadable"), image("unjudged")],
      verdictsByImageId: new Map([["unloadable", verdict("產品視頻截圖")]]),
      unavailableIds: ["unloadable"],
      now,
      ctx,
    });

    expect(plan.writes).toEqual([]);
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it("accumulates one merged entry across many images", () => {
    const ctx = span();

    planChunkImageWrites({
      chunk: [image("a"), image("b")],
      verdictsByImageId: new Map([
        ["a", verdict("產品視頻截圖")],
        ["b", verdict("視頻與視頻的差別")],
      ]),
      unavailableIds: [],
      now,
      ctx,
    });

    expect(hits(ctx)).toEqual([
      {
        field: "alt_zh",
        term: "視頻",
        replacement: "影片",
        count: 3,
      },
    ]);
    expect(ctx.summary.bannedTermCount).toBe(3);
  });

  it("records nothing for clean alt text", () => {
    const ctx = span();
    const altZh = "產品影片截圖";

    const plan = planChunkImageWrites({
      chunk: [image("a")],
      verdictsByImageId: new Map([["a", verdict(altZh)]]),
      unavailableIds: [],
      now,
      ctx,
    });

    expect(plan.writes[0]?.row.alt_zh).toBe(altZh);
    expect(hits(ctx)).toEqual([]);
    expect(ctx.summary.bannedTermCount).toBeUndefined();
  });

  it("never rewrites a boundary false positive", () => {
    const altZh = "台南市保安路的店門口";
    expect(verdict(altZh).altZh).toBe(altZh);
  });
});
