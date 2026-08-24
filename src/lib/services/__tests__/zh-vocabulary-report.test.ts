import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCallContext } from "@/lib/audit";
import { extractBrandFacts, parseBrandFactsResult } from "../brand-facts";

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

