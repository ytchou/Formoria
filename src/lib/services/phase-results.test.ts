import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { parsePhaseResults } from "./phase-results";

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
});
