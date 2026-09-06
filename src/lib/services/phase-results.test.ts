import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import type { PhaseResult } from "@/lib/types/curation";
import { lastAcquireRecordedBudgetExhausted, parsePhaseResults } from "./phase-results";

describe("parsePhaseResults", () => {
  it("returns an empty list for anything that is not an array", () => {
    expect(parsePhaseResults(null)).toEqual([]);
    expect(parsePhaseResults({ phase: "clean" } as Json)).toEqual([]);
  });

  it("drops entries with a missing or unknown status", () => {
    const parsed = parsePhaseResults([
      { phase: "clean" },
      { phase: "detect", status: "running" },
      { status: "failed" },
      "clean",
      null,
      { phase: "links", status: "succeeded" },
    ] as Json);

    expect(parsed.map((result) => result.phase)).toEqual(["links"]);
  });

  it("keeps providerFailure so an outage stays visible to the job summary", () => {
    const parsed = parsePhaseResults([
      {
        phase: "descriptions",
        status: "failed",
        changedFields: ["descriptionZh"],
        durationMs: 1234,
        error: "LLM provider unavailable",
        detail: "insufficient_quota",
        providerFailure: true,
      },
    ] as Json);

    expect(parsed.at(0)).toEqual({
      phase: "descriptions",
      status: "failed",
      changedFields: ["descriptionZh"],
      durationMs: 1234,
      error: "LLM provider unavailable",
      detail: "insufficient_quota",
      providerFailure: true,
    });
  });

  it("omits providerFailure when it is absent or not a real boolean true", () => {
    const parsed = parsePhaseResults([
      { phase: "clean", status: "succeeded" },
      { phase: "detect", status: "failed", providerFailure: "true" },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("providerFailure");
    expect(parsed.at(1)).not.toHaveProperty("providerFailure");
  });

  it("preserves catalogZeroReason through round-trip", () => {
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "skipped",
        changedFields: [],
        durationMs: 0,
        catalogZeroReason: "no_catalog",
      },
    ] as Json);

    expect(parsed.at(0)?.catalogZeroReason).toBe("no_catalog");
  });

  it("preserves productsProposed through round-trip", () => {
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: ["products"],
        durationMs: 500,
        productsProposed: 5,
      },
    ] as Json);

    expect(parsed.at(0)?.productsProposed).toBe(5);
  });

  it("omits catalogZeroReason when absent", () => {
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
      },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("catalogZeroReason");
  });

  it("coerces malformed changedFields and durationMs instead of trusting them", () => {
    const parsed = parsePhaseResults([
      {
        phase: "images",
        status: "skipped",
        changedFields: ["heroImageUrl", 42, null],
        durationMs: "fast",
      },
    ] as Json);

    expect(parsed.at(0)?.changedFields).toEqual(["heroImageUrl"]);
    expect(parsed.at(0)?.durationMs).toBe(0);
  });

  it("preserves agentOutcome and acquisitionPlan through round-trip", () => {
    const plan = { urls: ["https://example.com"], render: true };
    const parsed = parsePhaseResults([
      {
        phase: "acquisition",
        status: "succeeded",
        changedFields: [],
        durationMs: 200,
        agentOutcome: "planned",
        acquisitionPlan: plan,
      },
    ] as Json);

    expect(parsed.at(0)?.agentOutcome).toBe("planned");
    expect(parsed.at(0)?.acquisitionPlan).toEqual(plan);

    // Non-object acquisitionPlan is dropped
    const parsed2 = parsePhaseResults([
      {
        phase: "acquisition",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        agentOutcome: "recovered",
        acquisitionPlan: "not-an-object",
      },
    ] as Json);
    expect(parsed2.at(0)?.agentOutcome).toBe("recovered");
    expect(parsed2.at(0)).not.toHaveProperty("acquisitionPlan");

    // Unknown agentOutcome string is dropped
    const parsed3 = parsePhaseResults([
      {
        phase: "acquisition",
        status: "failed",
        changedFields: [],
        durationMs: 50,
        agentOutcome: "invented",
      },
    ] as Json);
    expect(parsed3.at(0)).not.toHaveProperty("agentOutcome");
  });

  it("preserves revokedColumns through round-trip filtering non-strings", () => {
    const parsed = parsePhaseResults([
      {
        phase: "acquisition",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        revokedColumns: ["description_zh", 42, null, "blurb_zh"],
      },
    ] as Json);

    expect(parsed.at(0)?.revokedColumns).toEqual(["description_zh", "blurb_zh"]);
  });

  // The acquire phase's compact image pool is what a re-run and the admin job
  // view read back — PR 3 typed it on `PhaseResult` but never taught the parser
  // about it, so every pool was silently dropped on the round trip.
  it("image_pool_round_trip", () => {
    const imagePool = [
      { id: "image-1", tag: "product", score: 82, sourceUrl: "https://brand.example/p" },
      { id: "image-2", tag: "logo", score: 41 },
    ];
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        imagePool,
      },
    ] as Json);

    expect(parsed.at(0)?.imagePool).toEqual(imagePool);
  });

  it("drops imagePool when it is not an array of plain objects", () => {
    const parsed = parsePhaseResults([
      { phase: "acquire", status: "succeeded", imagePool: "not-an-array" },
      { phase: "acquire", status: "succeeded", imagePool: [["id"]] },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("imagePool");
    expect(parsed.at(1)).not.toHaveProperty("imagePool");
  });

  it("drops imagePool when serialized size exceeds 16KB", () => {
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        imagePool: [{ id: "image-1", tag: "product", score: 82, sourceUrl: "x".repeat(17_000) }],
      },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("imagePool");
  });

  it("drops acquisitionPlan when serialized size exceeds 8KB", () => {
    const largePlan = { data: "x".repeat(9000) };
    const parsed = parsePhaseResults([
      {
        phase: "acquisition",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        acquisitionPlan: largePlan,
      },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("acquisitionPlan");
  });

  it("preserves productsVerification through round-trip", () => {
    const verification = {
      read: 10,
      proposed: 5,
      verified: 4,
      repaired: 1,
      dropped: 1,
      dropReasons: { no_source: 1 },
    };
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: ["products"],
        durationMs: 3000,
        productsVerification: verification,
      },
    ] as Json);

    expect(parsed.at(0)?.productsVerification).toEqual(verification);
  });

  it("drops productsVerification when it is not a plain object", () => {
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        productsVerification: "not-an-object",
      },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("productsVerification");

    const parsed2 = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        productsVerification: [1, 2, 3],
      },
    ] as Json);

    expect(parsed2.at(0)).not.toHaveProperty("productsVerification");
  });

  it("drops productsVerification when serialized size exceeds 8KB", () => {
    const largeVerification = { data: "x".repeat(9000) };
    const parsed = parsePhaseResults([
      {
        phase: "products",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
        productsVerification: largeVerification,
      },
    ] as Json);

    expect(parsed.at(0)).not.toHaveProperty("productsVerification");
  });

  it("accepts proposed and repaired as valid agentOutcome values", () => {
    for (const outcome of ["proposed", "repaired"] as const) {
      const parsed = parsePhaseResults([
        {
          phase: "products",
          status: "succeeded",
          changedFields: [],
          durationMs: 100,
          agentOutcome: outcome,
        },
      ] as Json);

      expect(parsed.at(0)?.agentOutcome).toBe(outcome);
    }
  });

  it("parses_link_expansion_within_cap", () => {
    const linkExpansion = {
      hubsFetched: 3,
      adopted: [
        { field: "instagram_url", url: "https://instagram.com/brand", source: "hub" },
        { field: "facebook_url", url: "https://facebook.com/brand", source: "serp" },
      ],
      serp: "searched",
    };
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: ["instagram_url"],
        durationMs: 450,
        linkExpansion,
      },
    ] as Json);

    expect(parsed.at(0)?.linkExpansion).toEqual(linkExpansion);
  });

  it("parses_link_expansion_sources_evidence_and_followers", () => {
    const linkExpansion = {
      hubsFetched: 1,
      adopted: [
        {
          field: "purchaseMyship",
          url: "https://myship.7-11.com.tw/general/detail/GM123",
          source: "threads",
        },
      ],
      serp: "none",
      sources: {
        hubs: "skipped",
        threads: "found",
        serpName: "absent",
        serpHandle: "skipped",
      },
      evidence: "conclusive",
      instagramFollowers: 8014,
    };
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: ["purchase_myship"],
        durationMs: 320,
        linkExpansion,
      },
    ] as Json);

    expect(parsed.at(0)?.linkExpansion).toEqual(linkExpansion);
    expect(parsed.at(0)?.linkExpansion?.sources?.threads).toBe("found");
    expect(parsed.at(0)?.linkExpansion?.evidence).toBe("conclusive");
    expect(parsed.at(0)?.linkExpansion?.instagramFollowers).toBe(8014);
    expect(parsed.at(0)?.linkExpansion?.adopted.at(0)?.source).toBe("threads");
  });

  it("link_expansion_without_sources_still_parses", () => {
    // The DEV-1692 shape. A trace written before DEV-1702 carries no
    // `sources`, and must keep parsing: a missing key reads as "no evidence
    // recorded", never as "every source answered absent".
    const linkExpansion = {
      hubsFetched: 2,
      adopted: [
        {
          field: "purchasePinkoi",
          url: "https://www.pinkoi.com/store/mybrand",
          source: "hub",
        },
      ],
      serp: "replayed",
      gated: "hub_unconfirmed:linktr.ee",
    };
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 120,
        linkExpansion,
      },
    ] as Json);

    expect(parsed.at(0)?.linkExpansion).toEqual(linkExpansion);
    expect(parsed.at(0)?.linkExpansion?.sources).toBeUndefined();
    expect(parsed.at(0)?.linkExpansion?.evidence).toBeUndefined();
  });

  it("drops_oversized_link_expansion", () => {
    const linkExpansion = {
      hubsFetched: 1,
      adopted: [{ field: "website", url: "x".repeat(9000), source: "hub" }],
      serp: "none",
    };
    const parsed = parsePhaseResults([
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: ["website"],
        durationMs: 100,
        linkExpansion,
        agentOutcome: "planned",
      },
    ] as Json);

    // linkExpansion dropped but other fields preserved
    expect(parsed.at(0)).not.toHaveProperty("linkExpansion");
    expect(parsed.at(0)?.agentOutcome).toBe("planned");
  });
});

describe("lastAcquireRecordedBudgetExhausted", () => {
  it("detects_budget_exhausted_in_last_acquire_trace", () => {
    // Case 1: acquisitionPlan.error === 'aborted'
    const results1: PhaseResult[] = [
      {
        phase: "detect",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
      },
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 500,
        acquisitionPlan: { error: "aborted" },
      },
    ];
    expect(lastAcquireRecordedBudgetExhausted(results1)).toBe(true);

    // Case 2: trace[].reason containing 'budget_exhausted'
    const results2: PhaseResult[] = [
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 500,
        acquisitionPlan: {
          trace: [
            { step: "render", reason: "budget_exhausted" },
          ],
        },
      },
    ];
    expect(lastAcquireRecordedBudgetExhausted(results2)).toBe(true);

    // Case 3: no acquire entry at all → false
    const results3: PhaseResult[] = [
      {
        phase: "detect",
        status: "succeeded",
        changedFields: [],
        durationMs: 100,
      },
    ];
    expect(lastAcquireRecordedBudgetExhausted(results3)).toBe(false);

    // Case 4: acquire entry with no budget signal → false
    const results4: PhaseResult[] = [
      {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 500,
        acquisitionPlan: { urls: ["https://example.com"] },
      },
    ];
    expect(lastAcquireRecordedBudgetExhausted(results4)).toBe(false);
  });
});
