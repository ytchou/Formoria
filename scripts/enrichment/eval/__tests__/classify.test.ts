import { describe, expect, it } from "vitest";

import { type ClassifyInput, classify } from "../classify";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    targetRow: {
      status: "completed",
      phase_results: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — transient infra (no target / not completed / cancelled)
// ---------------------------------------------------------------------------

describe("transient_infra_failure", () => {
  it("no target row", () => {
    const result = classify({ targetRow: null });
    expect(result.observed).toBe("transient_infra_failure");
    expect(result.stage).toBe("infra");
  });

  it("job not completed", () => {
    const result = classify(
      makeInput({ jobStatus: "running" }),
    );
    expect(result.observed).toBe("transient_infra_failure");
    expect(result.stage).toBe("infra");
  });

  it("target cancelled", () => {
    const result = classify(
      makeInput({
        targetRow: { status: "cancelled", phase_results: [] },
      }),
    );
    expect(result.observed).toBe("transient_infra_failure");
    expect(result.stage).toBe("infra");
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — provider failure
// ---------------------------------------------------------------------------

describe("provider failure in a phase", () => {
  it("providerFailure flag on a phase", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "failed", providerFailure: true },
          ],
        },
      }),
    );
    expect(result.observed).toBe("transient_infra_failure");
    expect(result.stage).toBe("infra");
  });

  it("error starting with LLM provider unavailable", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "products",
              status: "failed",
              error: "LLM provider unavailable: rate limit",
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("transient_infra_failure");
    expect(result.stage).toBe("infra");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — persistence failure (apply failed)
// ---------------------------------------------------------------------------

describe("persistence_failure via apply", () => {
  it("apply with 'Refresh is stale' detail", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "products", status: "succeeded", productsProposed: 3 },
          ],
        },
        applyOutcome: {
          applied: [
            { slug: "test", ok: false, detail: "Refresh is stale: updated_at mismatch" },
          ],
        },
      }),
    );
    expect(result.observed).toBe("persistence_failure");
    expect(result.stage).toBe("persist");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — persistence failure (skipped with "no new enrichment")
// ---------------------------------------------------------------------------

describe("persistence_failure via skipped target", () => {
  it("target skipped with 'no new enrichment fields'", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "skipped",
          error: "no new enrichment fields to write",
          phase_results: [
            { phase: "products", status: "succeeded", productsProposed: 2 },
          ],
        },
      }),
    );
    expect(result.observed).toBe("persistence_failure");
    expect(result.stage).toBe("persist");
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — success_products (agape-style)
// ---------------------------------------------------------------------------

describe("success_products", () => {
  it("products succeeded with proposals", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "succeeded" },
            { phase: "products", status: "succeeded", productsProposed: 4 },
          ],
        },
      }),
    );
    expect(result.observed).toBe("success_products");
    expect(result.stage).toBe("products");
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — render_required (catalogZeroReason: render_blocked)
// ---------------------------------------------------------------------------

describe("render_required", () => {
  it("catalogZeroReason render_blocked", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "acquire",
              status: "succeeded",
              catalogZeroReason: "render_blocked",
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("render_required");
    expect(result.stage).toBe("catalog");
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — host_resolution_failure (route_broken)
// ---------------------------------------------------------------------------

describe("host_resolution_failure", () => {
  it("catalogZeroReason route_broken", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "acquire",
              status: "succeeded",
              catalogZeroReason: "route_broken",
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("host_resolution_failure");
    expect(result.stage).toBe("catalog");
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — catalog_discovery_failure
// ---------------------------------------------------------------------------

describe("catalog_discovery_failure", () => {
  it("rule8_catalog_on_acquisition_model_refused", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "acquire",
              status: "succeeded",
              acquisitionPlan: { error: "model_refused" },
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("catalog_discovery_failure");
    expect(result.stage).toBe("catalog");
    expect(result.evidence).toContain("acquisition model_refused");
  });
});

// ---------------------------------------------------------------------------
// Rule 9 — zero:no_catalog (taiwan-dye style)
// ---------------------------------------------------------------------------

describe("zero:no_catalog", () => {
  it("catalogZeroReason no_catalog", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "acquire",
              status: "succeeded",
              catalogZeroReason: "no_catalog",
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("zero:no_catalog");
    expect(result.stage).toBe("catalog");
  });
});

// ---------------------------------------------------------------------------
// Rule 10 — fetch_blocked
// ---------------------------------------------------------------------------

describe("fetch_blocked", () => {
  it("HTTP 403 in dropReasons, verified+repaired = 0", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "succeeded" },
            {
              phase: "products",
              status: "succeeded",
              productsProposed: 0,
              productsVerification: {
                proposed: 3,
                verified: 0,
                repaired: 0,
                dropped: 3,
                dropReasons: { "HTTP 403": 3 },
              },
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("fetch_blocked");
    expect(result.stage).toBe("verify");
  });
});

// ---------------------------------------------------------------------------
// Rule 11 — validation_failure (host_mismatch in dropReasons)
// ---------------------------------------------------------------------------

describe("validation_failure", () => {
  it("host_mismatch drops all proposals", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "succeeded" },
            {
              phase: "products",
              status: "succeeded",
              productsProposed: 0,
              productsVerification: {
                proposed: 5,
                verified: 0,
                repaired: 0,
                dropped: 5,
                dropReasons: { "host mismatch": 5 },
              },
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("validation_failure");
    expect(result.stage).toBe("verify");
  });
});

// ---------------------------------------------------------------------------
// Rule 12 — extraction_failure
// ---------------------------------------------------------------------------

describe("extraction_failure", () => {
  it("products phase failed (non-provider)", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "succeeded" },
            { phase: "products", status: "failed" },
          ],
        },
      }),
    );
    expect(result.observed).toBe("extraction_failure");
    expect(result.stage).toBe("products");
  });

  it.each(["model_refused", "model_truncated", "model_filtered"])(
    "rule12_extraction_failure_on_%s",
    (reason) => {
      const detail = `${reason}: products agent fell back`;
      const result = classify(
        makeInput({
          targetRow: {
            status: "completed",
            phase_results: [
              { phase: "acquire", status: "succeeded" },
              {
                phase: "products",
                status: "succeeded",
                productsProposed: 0,
                agentOutcome: "fallback",
                detail,
              },
            ],
          },
        }),
      );
      expect(result.observed).toBe("extraction_failure");
      expect(result.stage).toBe("products");
      expect(result.evidence).toContain(`products fallback: ${detail}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Rule 13 — unsupported_source_shape
// ---------------------------------------------------------------------------

describe("unsupported_source_shape", () => {
  it("surfaces acquired, 0 proposals, fallback with no_proposals", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            {
              phase: "acquire",
              status: "succeeded",
              acquisitionPlan: {
                surfaces: [
                  { url: "https://example.com", fetch: "static", reason: "home" },
                ],
              },
            },
            {
              phase: "products",
              status: "succeeded",
              productsProposed: 0,
              agentOutcome: "fallback",
              detail: "no_proposals: could not extract structured products",
            },
          ],
        },
      }),
    );
    expect(result.observed).toBe("unsupported_source_shape");
    expect(result.stage).toBe("products");
  });
});

// ---------------------------------------------------------------------------
// Rule 14 — zero:unclassified (miin / data_defect style)
// ---------------------------------------------------------------------------

describe("zero:unclassified", () => {
  it("0 proposals with no other signal", () => {
    const result = classify(
      makeInput({
        targetRow: {
          status: "completed",
          phase_results: [
            { phase: "acquire", status: "succeeded" },
            { phase: "products", status: "succeeded", productsProposed: 0 },
          ],
        },
      }),
    );
    expect(result.observed).toBe("zero:unclassified");
    expect(result.stage).toBe("products");
  });
});
