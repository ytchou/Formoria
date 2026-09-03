import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateLlmProviderGate,
  evaluateProviderGate,
  evaluateStorageGate,
  hasMaterialPatchValues,
  hasNoEnrichmentInputs,
  isLlmProviderFailureMessage,
  isProductsScopedRun,
  isProviderFailureMessage,
  llmStageFailure,
  storageStageFailure,
} from "../curation-operations";
import type { PhaseResult } from "@/lib/types/curation";

/**
 * The pipeline gates are tested as pure decision helpers rather than by
 * mocking the whole per-brand loop. After the wave collapse (Task 8/9),
 * Gate A reads acquire results and Gate B reads acquire evidence.
 */

afterEach(() => {
  delete process.env.CURATION_PROVIDER_GATE;
});

describe("Gate A — acquire-based provider gate", () => {
  it("gate_a_fires_on_acquire_provider_failure", () => {
    const decision = evaluateProviderGate({
      acquireResult: phase("links", "failed", { providerFailure: true }),
    });

    expect(decision).toEqual({
      action: "fail",
      message: expect.stringContaining("provider"),
    });
  });

  it("gate_a_passes_on_successful_acquire", () => {
    const decision = evaluateProviderGate({
      acquireResult: phase("links", "succeeded"),
    });

    expect(decision).toBeNull();
  });

  it("gate_a_passes_when_acquire_skipped", () => {
    const decision = evaluateProviderGate({
      acquireResult: phase("links", "skipped"),
    });

    expect(decision).toBeNull();
  });

  it("gate_a_passes_on_non_provider_failure", () => {
    const decision = evaluateProviderGate({
      acquireResult: phase("links", "failed", { error: "scrape blew up" }),
    });

    expect(decision).toBeNull();
  });

  it("downgrades to a warning when CURATION_PROVIDER_GATE=off", () => {
    process.env.CURATION_PROVIDER_GATE = "off";

    const decision = evaluateProviderGate({
      acquireResult: phase("links", "failed", { providerFailure: true }),
    });

    expect(decision?.action).toBe("warn");
  });

  it("stays active for any value other than off", () => {
    process.env.CURATION_PROVIDER_GATE = "on";

    expect(
      evaluateProviderGate({
        acquireResult: phase("links", "failed", { providerFailure: true }),
      })?.action,
    ).toBe("fail");
  });
});

describe("Gate B — hasNoEnrichmentInputs (acquire-based)", () => {
  it("gate_b_skips_when_acquire_found_nothing", () => {
    // Acquire ran but produced no evidence — skip
    expect(
      hasNoEnrichmentInputs({
        knownUrls: [],
        acquireResult: {
          scrapedData: null,
          scrapedImageUrls: [],
        },
      }),
    ).toBe(true);
  });

  it("gate_b_passes_when_acquire_has_content", () => {
    // Acquire produced scraped data
    expect(
      hasNoEnrichmentInputs({
        knownUrls: [],
        acquireResult: {
          scrapedData: { brandName: "Test" },
          scrapedImageUrls: [],
        },
      }),
    ).toBe(false);
  });

  it("gate_b_passes_when_acquire_has_images", () => {
    expect(
      hasNoEnrichmentInputs({
        knownUrls: [],
        acquireResult: {
          scrapedData: null,
          scrapedImageUrls: ["https://img.tw/1.jpg"],
        },
      }),
    ).toBe(false);
  });

  it("gate_b_falls_back_to_knownUrls_when_acquire_absent", () => {
    // Acquire was satisfied-skipped — fall back to knownUrls
    expect(
      hasNoEnrichmentInputs({
        knownUrls: ["https://a.tw"],
      }),
    ).toBe(false);
    expect(
      hasNoEnrichmentInputs({
        knownUrls: [],
      }),
    ).toBe(true);
  });

  it("treats blank-only urls as no urls", () => {
    expect(
      hasNoEnrichmentInputs({ knownUrls: ["  ", ""] }),
    ).toBe(true);
  });
});

/**
 * Gate C is the LLM counterpart of Gate A and is tested the same way: as the
 * pure decision helper `runEnrich` branches on. It differs from Gate A in WHEN
 * it can fire — a search outage is visible in data the pipeline already holds,
 * an LLM outage is only discoverable by calling — so the helper takes the
 * brand's accumulated phase results rather than a provider response.
 */
function phase(
  name: string,
  status: PhaseResult["status"],
  extra: Partial<PhaseResult> = {},
): PhaseResult {
  return { phase: name, status, changedFields: [], durationMs: 0, ...extra };
}

describe("Gate C — llmStageFailure", () => {
  it("Gate C still fires with site_identity present", () => {
    expect(llmStageFailure([
      phase("descriptions", "failed", { providerFailure: true }),
      phase("site_identity", "skipped"),
    ])).toContain("descriptions")
  })

  it("Gate C is not diluted by a skipped site_identity", () => {
    expect(llmStageFailure([phase("site_identity", "skipped")])).toBeNull()
  })

  it("fails the target when every attempted LLM phase failed at the provider", () => {
    const decision = evaluateLlmProviderGate([
      phase("links", "succeeded"),
      phase("descriptions", "failed", { providerFailure: true }),
      phase("faq", "failed", { providerFailure: true }),
    ]);

    expect(decision?.action).toBe("fail");
    expect(decision?.message).toContain("LLM provider unavailable");
    expect(decision?.message).toContain("descriptions");
    expect(decision?.message).toContain("faq");
  });

  // The regression that matters most: on 2026-08-02 the run went green because
  // an empty result was indistinguishable from an outage. Over-correcting the
  // other way — failing every brand the model had nothing to say about — would
  // be just as wrong, so a healthy phase always clears the gate.
  it("does not fire when a single LLM phase got through", () => {
    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "succeeded"),
        phase("faq", "failed", { providerFailure: true }),
      ]),
    ).toBeNull();
  });

  it("does not fire on an LLM failure that was not a provider failure", () => {
    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "failed", { error: "persist blew up" }),
      ]),
    ).toBeNull();
  });

  it("ignores skipped LLM phases when deciding what was attempted", () => {
    // Scope-skipped phases are not attempts. A run whose only attempted LLM
    // phase died still fails; a run where everything was skipped does not.
    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "skipped"),
        phase("faq", "failed", { providerFailure: true }),
      ])?.action,
    ).toBe("fail");
    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "skipped"),
        phase("faq", "skipped"),
      ]),
    ).toBeNull();
  });

  it("ignores non-LLM phases entirely", () => {
    // A failed Serper phase is Gate A's business; Gate C must not double-count
    // it, or a search outage would be reported as an OpenAI outage.
    expect(
      evaluateLlmProviderGate([
        phase("discover", "failed", { providerFailure: true }),
        phase("links", "failed"),
      ]),
    ).toBeNull();
    expect(llmStageFailure([])).toBeNull();
  });

  it("gate_c_unchanged_with_acquire — fires when acquire is the only failed LLM phase", () => {
    // Acquire is an LLM phase; if it's the only one attempted and it failed
    // at the provider, Gate C fires
    const result = evaluateLlmProviderGate([
      phase("links", "succeeded"), // non-LLM
      phase("descriptions", "failed", { providerFailure: true }),
    ]);
    expect(result?.action).toBe("fail");
    expect(result?.message).toContain("LLM provider unavailable");
  });

  it("downgrades to a warning when CURATION_PROVIDER_GATE=off", () => {
    process.env.CURATION_PROVIDER_GATE = "off";

    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "failed", { providerFailure: true }),
      ])?.action,
    ).toBe("warn");
  });

  it("stays active for any value other than off", () => {
    process.env.CURATION_PROVIDER_GATE = "on";

    expect(
      evaluateLlmProviderGate([
        phase("descriptions", "failed", { providerFailure: true }),
      ])?.action,
    ).toBe("fail");
  });
});

/**
 * DEV-1374. A Supabase Storage outage stops the vision phase reading its own
 * inputs. Reported as a provider failure it would set `providerFailure`, which
 * Gate C counts and the LLM circuit breaker consumes — and three consecutive
 * trips (with ENRICH_BRAND_CONCURRENCY at 3, one wave) cancel every unstarted
 * target in the job and page the operator about an OpenAI account that was
 * healthy the whole time. The target still fails; only the attribution moves.
 */
describe("Gate C-storage — storageStageFailure", () => {
  const storageFailure = phase("classify_images", "failed", {
    error:
      "Storage unavailable — could not read the images for any of 2 batch(es) out of Storage",
  });

  it("fails the target when a phase could not read its inputs", () => {
    const decision = evaluateStorageGate([
      phase("descriptions", "succeeded"),
      storageFailure,
    ]);

    expect(decision?.action).toBe("fail");
    expect(decision?.message).toContain("classify_images");
  });

  it("never reads as a provider failure, so the breaker is not fed", () => {
    const message = storageStageFailure([storageFailure]);

    expect(message).not.toBeNull();
    expect(isProviderFailureMessage(message)).toBe(false);
    expect(isLlmProviderFailureMessage(message)).toBe(false);
  });

  it("leaves Gate C untouched — a storage failure is not an LLM outage", () => {
    // The whole point: same phase, same failed status, no `providerFailure`, so
    // Gate C sees an attempted LLM phase that did not fail at the provider.
    expect(llmStageFailure([storageFailure])).toBeNull();
  });

  it("ignores failures that are not ours and succeeded phases", () => {
    expect(
      evaluateStorageGate([
        phase("classify_images", "failed", { providerFailure: true }),
        phase("descriptions", "succeeded"),
      ]),
    ).toBeNull();
    expect(storageStageFailure([])).toBeNull();
  });

  it("shares the CURATION_PROVIDER_GATE kill switch", () => {
    process.env.CURATION_PROVIDER_GATE = "off";

    expect(evaluateStorageGate([storageFailure])?.action).toBe("warn");
  });
});

describe("isProviderFailureMessage", () => {
  it("accepts both the Serper and the LLM prefix", () => {
    // One predicate for both gates: the job summary counts them together, and
    // an operator's response ("stop the run, fix the account") is identical.
    expect(
      isProviderFailureMessage("Search provider unavailable — SERP: 400"),
    ).toBe(true);
    expect(
      isProviderFailureMessage(
        "LLM provider unavailable — every attempted LLM phase failed at the provider: descriptions",
      ),
    ).toBe(true);
    expect(isProviderFailureMessage("No usable enrichment inputs")).toBe(false);
    expect(isProviderFailureMessage(null)).toBe(false);
  });

  it("separates the LLM half for the circuit breaker", () => {
    expect(
      isLlmProviderFailureMessage("Search provider unavailable — SERP: 400"),
    ).toBe(false);
    expect(isLlmProviderFailureMessage("LLM provider unavailable — x")).toBe(
      true,
    );
  });
});

/**
 * Gate C's empty-patch branch. Both cases below produce the IDENTICAL patch —
 * `{ products: [] }` — so the decision can only come from what the run was
 * asked to do, which is why this is not a bare key count.
 */
describe("hasMaterialPatchValues", () => {
  const productsScopedRun = { productsScopedRun: true };
  const fullRun = { productsScopedRun: false };

  it("keeps a full enrichment run that found nothing on the skipped path", () => {
    // Fifteen phases ran and none found a field. That is the shape Gate C
    // reports as `skipped`, with the WEAK-BRAND counter behind it — one phase's
    // empty proposal list must not stand in for a patch and retire both.
    expect(hasMaterialPatchValues({ products: [] }, fullRun)).toBe(false);
    expect(hasMaterialPatchValues({}, fullRun)).toBe(false);
  });

  it("treats an empty proposal list as a real patch for a products-scoped run", () => {
    // The products phase emits `products: []` when it RAN and found nothing, so
    // a stale proposal list is cleared. Recording that as `skipped` leaves the
    // refresh submission pending and un-approvable, and the brand's
    // pending-refresh unique index (23505) then blocks every later refresh.
    expect(hasMaterialPatchValues({ products: [] }, productsScopedRun)).toBe(
      true,
    );
    expect(hasMaterialPatchValues({}, productsScopedRun)).toBe(false);
  });

  it("counts any other field, and a non-empty proposal list, on both paths", () => {
    expect(hasMaterialPatchValues({ products: [], city: "台南" }, fullRun)).toBe(
      true,
    );
    expect(
      hasMaterialPatchValues({ products: [{ key: "mug" }] }, fullRun),
    ).toBe(true);
  });
});

describe("isProductsScopedRun", () => {
  it("accepts the backfill's own phase set and nothing wider", () => {
    expect(isProductsScopedRun(["links", "site_identity", "products"])).toBe(
      true,
    );
    expect(isProductsScopedRun(["products"])).toBe(true);
    // A full run names `products` too. It is not products-scoped.
    expect(
      isProductsScopedRun([
        "clean",
        "discover",
        "links",
        "site_identity",
        "descriptions",
        "products",
      ]),
    ).toBe(false);
    expect(isProductsScopedRun(["links", "site_identity"])).toBe(false);
    expect(isProductsScopedRun([])).toBe(false);
  });
});
