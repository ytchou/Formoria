/**
 * Pure formatting logic for the agent trace exporter.
 * No Supabase client — only the exported functions that read phase results and
 * render decision timelines, tool spans and the per-brand summary row.
 */
import { describe, expect, it } from "vitest";

import type { PriceRow } from "@/lib/services/llm-pricing";

import {
  type AiTurn,
  type BrandTraceRow,
  type DecisionStep,
  type PhaseResultRow,
  type ToolSpan,
  acquirePhaseResult,
  buildBrandTraceRow,
  countSearches,
  editorialOutcome,
  extractDecisions,
  phaseDurations,
  productsPhaseResult,
  renderDecisionTimeline,
  renderSummaryTable,
  summarizeImagePool,
  summarizeProductsVerification,
  summarizeTurns,
} from "../export-traces";

// ---------------------------------------------------------------------------
// renderDecisionTimeline
// ---------------------------------------------------------------------------

describe("renderDecisionTimeline", () => {
  it("export_renders_decision_timeline_in_order — decisions sorted by ms", () => {
    const decisions: DecisionStep[] = [
      { ms: 200, phase: "plan", action: "selected search strategy", detail: "google" },
      { ms: 100, phase: "plan", action: "parsed brand row", detail: "slug=alpha" },
      { ms: 500, phase: "execute", action: "scraped website", detail: "https://alpha.com" },
    ];
    const spans: ToolSpan[] = [];

    const md = renderDecisionTimeline("alpha", decisions, spans);

    const lines = md.split("\n").filter((l) => l.startsWith("|"));
    // Header + separator + 3 data rows
    expect(lines).toHaveLength(5);

    // Verify order: 100ms, 200ms, 500ms
    const msValues = lines
      .slice(2) // skip header + separator
      .map((line) => {
        const cells = line.split("|").map((c) => c.trim());
        return parseInt(cells[1], 10);
      });
    expect(msValues).toEqual([100, 200, 500]);
  });

  it("tool spans are joined by spanId into the timeline", () => {
    const decisions: DecisionStep[] = [
      { ms: 100, phase: "plan", action: "start", detail: "" },
    ];
    const spans: ToolSpan[] = [
      {
        spanId: "sp-1",
        provider: "openai",
        ms: 150,
        durationMs: 320,
        status: 200,
        detail: "gpt-4o completion",
      },
      {
        spanId: "sp-2",
        provider: "browserless",
        ms: 400,
        durationMs: 1200,
        status: 200,
        detail: "scrape https://alpha.com",
      },
    ];

    const md = renderDecisionTimeline("alpha", decisions, spans);

    // All entries present (1 decision + 2 spans = 3 data rows)
    const dataRows = md.split("\n").filter((l) => l.startsWith("|")).slice(2);
    expect(dataRows).toHaveLength(3);

    // Sorted by ms: 100, 150, 400
    const msValues = dataRows.map((line) => {
      const cells = line.split("|").map((c) => c.trim());
      return parseInt(cells[1], 10);
    });
    expect(msValues).toEqual([100, 150, 400]);

    // Span rows include provider and duration
    expect(md).toContain("openai");
    expect(md).toContain("320ms");
    expect(md).toContain("browserless");
    expect(md).toContain("1200ms");
  });

  it("empty decisions and spans produce a header-only table", () => {
    const md = renderDecisionTimeline("empty-brand", [], []);
    const lines = md.split("\n").filter((l) => l.startsWith("|"));
    // Header + separator only
    expect(lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Phase lookup — `acquire` is the live key, `links` the retired one (F18)
// ---------------------------------------------------------------------------

describe("acquirePhaseResult", () => {
  it("reads the acquire phase written by the current pipeline", () => {
    const results: PhaseResultRow[] = [
      { phase: "detect", status: "succeeded" },
      { phase: "acquire", status: "succeeded", agentOutcome: "planned" },
    ];

    expect(acquirePhaseResult(results)?.agentOutcome).toBe("planned");
  });

  it("falls back to the retired links key so PR-1-era rows still export", () => {
    const results: PhaseResultRow[] = [
      { phase: "links", status: "succeeded", agentOutcome: "fallback" },
    ];

    expect(acquirePhaseResult(results)?.agentOutcome).toBe("fallback");
  });

  it("prefers acquire when a row carries both keys", () => {
    const results: PhaseResultRow[] = [
      { phase: "links", status: "succeeded", agentOutcome: "fallback" },
      { phase: "acquire", status: "succeeded", agentOutcome: "recovered" },
    ];

    expect(acquirePhaseResult(results)?.agentOutcome).toBe("recovered");
  });

  it("returns undefined for a non-array phase_results value", () => {
    expect(acquirePhaseResult(null)).toBeUndefined();
    expect(acquirePhaseResult({ phase: "acquire" })).toBeUndefined();
    expect(productsPhaseResult(undefined)).toBeUndefined();
  });
});

describe("extractDecisions", () => {
  it("prefers the runtime trace over the planner's own decision list", () => {
    const phase: PhaseResultRow = {
      phase: "acquire",
      status: "succeeded",
      acquisitionPlan: {
        decisions: [{ step: "plan", action: "planned", reason: "stale", ms: 1 }],
        trace: [{ step: "gather", action: "probed", reason: "live", ms: 5 }],
      },
    };

    expect(extractDecisions(phase)).toEqual([
      { ms: 5, phase: "gather", action: "probed", detail: "live" },
    ]);
  });

  it("returns an empty list when the phase is missing", () => {
    expect(extractDecisions(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Editorial outcome — three phases, one agent
// ---------------------------------------------------------------------------

describe("editorialOutcome", () => {
  it("joins the outcome of every editorial phase the run produced", () => {
    const results: PhaseResultRow[] = [
      { phase: "acquire", status: "succeeded", agentOutcome: "planned" },
      { phase: "descriptions", status: "succeeded", agentOutcome: "repaired" },
      { phase: "stockists", status: "skipped" },
      { phase: "faq", status: "succeeded", agentOutcome: "proposed" },
    ];

    expect(editorialOutcome(results)).toBe(
      "descriptions:repaired stockists:- faq:proposed",
    );
  });

  it("reports a dash when no editorial phase ran", () => {
    expect(editorialOutcome([{ phase: "acquire", status: "succeeded" }])).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// Image pool, products verification, searches, durations
// ---------------------------------------------------------------------------

describe("summarizeImagePool", () => {
  it("counts stored rows, keeps, and names the top-ranked keep as hero", () => {
    const pool = [
      { id: "img-junk", tag: "promo", score: 9 },
      { id: "img-hero", tag: "product", score: 8 },
      { id: "img-2", tag: "lifestyle", score: 7 },
    ];

    expect(summarizeImagePool(pool)).toEqual({
      stored: 3,
      kept: 2,
      hero: "img-hero",
    });
  });

  it("reports a dash for hero when every image is junk-tagged", () => {
    expect(
      summarizeImagePool([{ id: "a", tag: "text_banner", score: 1 }]),
    ).toEqual({ stored: 1, kept: 0, hero: "-" });
  });

  it("treats a missing pool as zero images", () => {
    expect(summarizeImagePool(undefined)).toEqual({
      stored: 0,
      kept: 0,
      hero: "-",
    });
  });
});

describe("summarizeProductsVerification", () => {
  it("reads proposed / verified / dropped off the persisted record", () => {
    expect(
      summarizeProductsVerification({
        read: 6,
        rendered: 2,
        proposed: 5,
        verified: 4,
        dropped: 1,
      }),
    ).toEqual({ proposed: 5, verified: 4, dropped: 1, rendered: 2 });
  });

  it("returns zeroes when the phase carried no verification record", () => {
    expect(summarizeProductsVerification(undefined)).toEqual({
      proposed: 0,
      verified: 0,
      dropped: 0,
      rendered: 0,
    });
  });
});

describe("countSearches", () => {
  it("splits brand_search_results rows by search_type", () => {
    expect(
      countSearches([
        { search_type: "serp" },
        { search_type: "image" },
        { search_type: "image" },
        { search_type: "scrape" },
        { search_type: null },
      ]),
    ).toEqual({ serp: 1, image: 2, scrape: 1 });
  });
});

describe("phaseDurations", () => {
  it("sums the three editorial phases and reports acquire and products alone", () => {
    const results: PhaseResultRow[] = [
      { phase: "acquire", status: "succeeded", durationMs: 1000 },
      { phase: "descriptions", status: "succeeded", durationMs: 200 },
      { phase: "stockists", status: "succeeded", durationMs: 30 },
      { phase: "faq", status: "succeeded", durationMs: 70 },
      { phase: "products", status: "succeeded", durationMs: 500 },
    ];

    expect(phaseDurations(results)).toEqual({
      acquire: 1000,
      products: 500,
      editorial: 300,
    });
  });
});

// ---------------------------------------------------------------------------
// Turn cost — columns first, raw_response envelope second, prices last
// ---------------------------------------------------------------------------

const PRICES: PriceRow[] = [
  {
    model: "gpt-5-mini",
    input_per_m: 2,
    cached_input_per_m: 1,
    output_per_m: 10,
    effective_from: "2026-01-01T00:00:00Z",
  },
];

describe("summarizeTurns", () => {
  it("sums the stored cost when the audit row already priced the turn", () => {
    const turns: AiTurn[] = [
      {
        model: "gpt-5-mini",
        phase: "acquire",
        prompt_tokens: 1000,
        completion_tokens: 500,
        cost_usd: 0.25,
        created_at: "2026-09-03T00:00:00Z",
      },
    ];

    expect(summarizeTurns(turns, PRICES)).toEqual({
      turns: 1,
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: 0.25,
      unpricedTurns: 0,
    });
  });

  it("prices an unpriced turn from llm_model_prices", () => {
    const turns: AiTurn[] = [
      {
        model: "gpt-5-mini",
        phase: "products",
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        cost_usd: null,
        created_at: "2026-09-03T00:00:00Z",
      },
    ];

    // 1M uncached prompt at $2 + 1M completion at $10.
    expect(summarizeTurns(turns, PRICES).costUsd).toBeCloseTo(12, 6);
  });

  it("falls back to the raw_response usage envelope when the columns are null", () => {
    const turns: AiTurn[] = [
      {
        model: "gpt-5-mini",
        phase: "acquire",
        created_at: "2026-09-03T00:00:00Z",
        raw_response: {
          usage: { prompt_tokens: 300, completion_tokens: 40 },
        },
      },
    ];

    const totals = summarizeTurns(turns, PRICES);
    expect(totals.promptTokens).toBe(300);
    expect(totals.completionTokens).toBe(40);
  });

  it("counts a turn whose model has no price row instead of costing it zero", () => {
    const turns: AiTurn[] = [
      {
        model: "some-unpriced-model",
        phase: "faq",
        prompt_tokens: 100,
        completion_tokens: 10,
        created_at: "2026-09-03T00:00:00Z",
      },
    ];

    const totals = summarizeTurns(turns, PRICES);
    expect(totals.costUsd).toBe(0);
    expect(totals.unpricedTurns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The per-brand row and the summary table
// ---------------------------------------------------------------------------

function sampleRow(): BrandTraceRow {
  return buildBrandTraceRow({
    slug: "alpha",
    phaseResults: [
      {
        phase: "acquire",
        status: "succeeded",
        durationMs: 1200,
        agentOutcome: "recovered",
        revokedColumns: ["social_instagram"],
        imagePool: [
          { id: "img-hero", tag: "product", score: 9 },
          { id: "img-junk", tag: "promo", score: 3 },
        ],
        acquisitionPlan: {
          surfaces: [{ url: "https://alpha.com", fetch: "static", reason: "home" }],
          fanOut: ["https://alpha.com/about"],
          budget: {
            allowed: { probes: 8, renders: 3, search: 1, turns: 6 },
            used: { probes: 4, renders: 2, search: 1, turns: 3 },
          },
        },
      },
      { phase: "descriptions", status: "succeeded", durationMs: 400, agentOutcome: "repaired" },
      {
        phase: "products",
        status: "succeeded",
        durationMs: 800,
        agentOutcome: "proposed",
        productsVerification: { proposed: 4, verified: 3, dropped: 1, rendered: 1 },
      },
    ],
    turns: [
      {
        model: "gpt-5-mini",
        phase: "acquire",
        prompt_tokens: 1000,
        completion_tokens: 100,
        cost_usd: 0.01,
        created_at: "2026-09-03T00:00:00Z",
      },
      {
        model: "gpt-5-mini",
        phase: "products",
        prompt_tokens: 500,
        completion_tokens: 50,
        cost_usd: 0.005,
        created_at: "2026-09-03T00:01:00Z",
      },
    ],
    prices: PRICES,
    searches: [{ search_type: "serp" }, { search_type: "image" }],
  });
}

describe("buildBrandTraceRow", () => {
  it("carries every agent's outcome, not only acquire's", () => {
    const row = sampleRow();

    expect(row.acquireOutcome).toBe("recovered");
    expect(row.productsOutcome).toBe("proposed");
    expect(row.editorial).toBe("descriptions:repaired");
  });

  it("adds the acquire budget renders to the products rendered pages", () => {
    expect(sampleRow().renders).toBe(3);
  });

  it("reports tokens, cost, searches, wall clock, images, revocations and products", () => {
    const row = sampleRow();

    expect(row.turns).toBe(2);
    expect(row.promptTokens).toBe(1500);
    expect(row.completionTokens).toBe(150);
    expect(row.costUsd).toBeCloseTo(0.015, 6);
    expect(row.searches).toEqual({ serp: 1, image: 1, scrape: 0 });
    expect(row.durations).toEqual({ acquire: 1200, products: 800, editorial: 400 });
    expect(row.images).toEqual({ stored: 2, kept: 1, hero: "img-hero" });
    expect(row.revokedColumns).toEqual(["social_instagram"]);
    expect(row.products).toEqual({ proposed: 4, verified: 3, dropped: 1, rendered: 1 });
  });

  it("degrades to dashes and zeroes for a brand with no phase results", () => {
    const row = buildBrandTraceRow({
      slug: "empty",
      phaseResults: null,
      turns: [],
      prices: PRICES,
      searches: [],
    });

    expect(row.acquireStatus).toBe("-");
    expect(row.acquireOutcome).toBe("-");
    expect(row.productsOutcome).toBe("-");
    expect(row.editorial).toBe("-");
    expect(row.renders).toBe(0);
    expect(row.images).toEqual({ stored: 0, kept: 0, hero: "-" });
  });
});

describe("renderSummaryTable", () => {
  it("renders one data row per brand under a header and separator", () => {
    const md = renderSummaryTable("job-1", [sampleRow()]);
    const lines = md.split("\n").filter((l) => l.startsWith("|"));

    expect(lines).toHaveLength(3);
    expect(md).toContain("job-1");
    expect(lines[2]).toContain("alpha");
    expect(lines[2]).toContain("recovered");
    expect(lines[2]).toContain("proposed");
  });

  it("escapes a pipe in an agent error so the table keeps its columns", () => {
    const row = buildBrandTraceRow({
      slug: "beta",
      phaseResults: [
        {
          phase: "acquire",
          status: "failed",
          acquisitionPlan: { error: "boom | split" },
        },
      ],
      turns: [],
      prices: PRICES,
      searches: [],
    });

    const dataRow = renderSummaryTable("job-1", [row])
      .split("\n")
      .filter((l) => l.startsWith("|"))[2];

    expect(dataRow).toContain("boom \\| split");
    // Header column count must survive the escape: only an UNescaped pipe is a
    // column boundary, which is exactly what the escape buys.
    const header = renderSummaryTable("job-1", [row])
      .split("\n")
      .filter((l) => l.startsWith("|"))[0];
    const columnBoundary = /(?<!\\)\|/g;
    expect(dataRow.split(columnBoundary).length).toBe(
      header.split(columnBoundary).length,
    );
  });
});
