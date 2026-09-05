import { describe, expect, it } from "vitest";
import { parseParams, resolvePhases } from "../job-runner";
import {
  DEFERRED_PHASES,
  phasesForTask,
} from "@/lib/constants/enrich-phases";

/**
 * `resolvePhases` is the only place a stored job row turns into the phase list
 * the runner executes. A deferred name reaching this far means the phase is
 * scheduled but has no runner (or, for `links`, that `acquire` silently never
 * runs) — the DEV-1644 failure this normalization exists to make impossible.
 */
describe("resolvePhases", () => {
  const deferred = new Set<string>(DEFERRED_PHASES);

  it("resolvePhases_never_returns_deferred", () => {
    const resolutions = [
      // No scope at all.
      resolvePhases({}),
      // Task-based (the admin UI's vocabulary).
      resolvePhases({ task: "visual" }),
      resolvePhases({ task: "identity" }),
      resolvePhases({ task: "editorial" }),
      resolvePhases({ task: "full" }),
      // Legacy `params.steps` rows.
      resolvePhases({ steps: ["image"] }),
      resolvePhases({ steps: ["context", "image", "detail"] }),
      resolvePhases({ steps: ["unknown_step"] }),
      // Explicit phases naming only retired/deferred names.
      resolvePhases({ phases: ["links", "images", "classify_images"] }),
      resolvePhases({ phases: ["clean", "discover", "site_identity"] }),
    ];

    for (const resolved of resolutions) {
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved.filter((phase) => deferred.has(phase))).toEqual([]);
    }
  });

  it("no_scope_defaults_to_the_full_task_closure", () => {
    // Never `[...ENRICH_PHASES]`: that list still carries the deferred names.
    expect(resolvePhases({})).toEqual(phasesForTask("full"));
    expect(resolvePhases({ steps: ["unknown_step"] })).toEqual(
      phasesForTask("full"),
    );
  });

  it("legacy_links_scope_resolves_to_acquire", () => {
    expect(resolvePhases({ phases: ["links"] })).toEqual(["acquire"]);
    expect(resolvePhases({ phases: ["links", "products"] })).toEqual([
      "acquire",
      "products",
    ]);
  });
});

describe("parseParams budgetScale", () => {
  it("budget_scale_param_reaches_config", () => {
    // Valid finite positive number is kept
    expect(parseParams({ budgetScale: 1.5 }).budgetScale).toBe(1.5);

    // Zero is rejected
    expect(parseParams({ budgetScale: 0 }).budgetScale).toBeUndefined();

    // Negative is rejected
    expect(parseParams({ budgetScale: -1 }).budgetScale).toBeUndefined();

    // String is rejected
    expect(parseParams({ budgetScale: "x" }).budgetScale).toBeUndefined();

    // NaN is rejected (not finite)
    expect(parseParams({ budgetScale: NaN }).budgetScale).toBeUndefined();

    // Absent is undefined
    expect(parseParams({}).budgetScale).toBeUndefined();
  });
});
