import type { PhaseResult } from "@/lib/types/curation";
import { auditedCall } from "@/lib/audit";
import {
  classifyCategoryBatch,
  detectBrandsBatch,
  MAX_PROBE_URLS,
  type BatchClassificationItem,
  type ClassificationResult,
  type DetectBatchItem,
  type DetectResult,
} from "../category-classifier";
import { isLlmProviderFailure } from "../_shared/llm-call-outcome";
import type { ProbeEvidence } from "./gather";
import { generateSlug } from "../brands";
import { isValidBrandName } from "../brand-cleanup";
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type EnrichBrand,
  type EnrichPatch,
  type SearchPhaseResult,
} from "./types";

const DETECT_PHASES = ["detect", "slugs", "tags"] as const;

/**
 * Whether the detect result's confidence level makes it eligible for a direct
 * write (slug, non-brand rejection, name candidate). Exported for the eval
 * harness phase adapter (DEV-1612).
 */
export function isHighConfidenceWrite(result: { confidence: string }): boolean {
  return result.confidence === "high";
}

export function shouldSkipForNonBrand(
  detectResult: DetectResult | undefined,
): boolean {
  return Boolean(
    detectResult?.isNonBrand === true && isHighConfidenceWrite(detectResult),
  );
}

/**
 * `tags` is deliberately NOT a trigger. The category moved to the descriptions
 * phase, so detect no longer produces anything a tags run consumes — a
 * DETAIL-only run was paying for a detect LLM call whose only possible effect
 * was renaming the brand. Mirrored in `curation-operations.ts`; keep both in
 * step.
 */
function hasDetectPhases(phases: BatchPhaseContext["phases"]): boolean {
  return phases.includes("detect") || phases.includes("slugs");
}

function buildDetectPatch(
  brand: EnrichBrand,
  detectResult: DetectResult | undefined,
  phases: readonly string[] = DETECT_PHASES,
): EnrichPatch {
  const patch: EnrichPatch = {};

  if (!detectResult) {
    return patch;
  }

  const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (
    phases.includes("slugs") &&
    isHighConfidenceWrite(detectResult) &&
    detectResult.slugGenerated &&
    detectResult.slugGenerated !== brand.slug &&
    KEBAB_CASE_RE.test(detectResult.slugGenerated)
  ) {
    patch.slug = detectResult.slugGenerated;
  }

  // No category write here on purpose: the category is a reasoning task the
  // descriptions phase owns, decided from the brand's own site text and its
  // classified image alt text. Detect only sees SERP snippets.

  if (
    detectResult.brandName &&
    isHighConfidenceWrite(detectResult) &&
    detectResult.brandName !== brand.name &&
    isValidBrandName(detectResult.brandName, brand.name ?? brand.slug)
  ) {
    // No `patch.name` write here any more. The `name` column has exactly one
    // writer, the `names` phase (DEV-1321) — detect contributes `brandName` as
    // the `detected` candidate instead, via `applyDetectResult`'s return. This
    // guard survives because the slug fallback below still depends on it: a slug
    // may only be derived from a name detect is confident enough to have
    // proposed.
    //
    // DETECT_SYSTEM_PROMPT tells the model to return a null slug rather than
    // transliterate a Han name, and the model obeys — this fallback then did the
    // exact thing the prompt forbids, because `generateSlug` Wade-Giles
    // romanises Han characters (`yuan-hsing-tung-fang-cha-yin-pur-sweets` on a
    // live run). So the fallback only applies to a name we can slug faithfully:
    // one with no Han at all. A Han name with no model slug keeps its existing
    // slug untouched. `generateSlug` itself is unchanged — `submissions.ts`
    // still depends on its current behaviour.
    if (!patch.slug && !/\p{Script=Han}/u.test(detectResult.brandName)) {
      const nameSlug = generateSlug(detectResult.brandName);
      if (nameSlug && nameSlug !== brand.slug && KEBAB_CASE_RE.test(nameSlug)) {
        patch.slug = nameSlug;
      }
    }
  }

  return patch;
}

// Probe cap imported from category-classifier.ts (prompt owner).

/**
 * Probe evidence worth prompt tokens: one that read a `<head>`. A timed-out or
 * blocked probe carries only the url it was asked about, which the item's own
 * `website` line already says.
 */
function usableProbes(
  evidence: readonly ProbeEvidence[] | undefined,
): DetectBatchItem["probes"] {
  if (!evidence?.length) return undefined;

  const usable = evidence
    .filter((probe) => Boolean(probe.title?.trim() || probe.description?.trim()))
    .slice(0, MAX_PROBE_URLS)
    .map((probe) => ({
      url: probe.url,
      ...(probe.title ? { title: probe.title } : {}),
      ...(probe.description ? { description: probe.description } : {}),
      ...(probe.platform ? { platform: probe.platform } : {}),
    }));

  return usable.length > 0 ? usable : undefined;
}

export async function runDetectPhase(
  ctx: BatchPhaseContext,
  searchResults: Map<string, SearchPhaseResult>,
  /**
   * Static probes of each brand's own known URLs, keyed by TARGET ID — the same
   * key rule every other per-brand map in the chunk follows, because `clean` and
   * `detect` can both rewrite a name and a name key would be a silent miss.
   */
  probeEvidence?: Map<string, readonly ProbeEvidence[]>,
): Promise<{
  phaseResult: PhaseResult;
  detectResults: Map<string, DetectResult>;
}> {
  if (!hasDetectPhases(ctx.phases)) {
    return {
      phaseResult: buildPhaseResult(
        "detect",
        "skipped",
        [],
        0,
        undefined,
        "no detect phases requested",
      ),
      detectResults: new Map(),
    };
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult(
        "detect",
        "skipped",
        [],
        0,
        undefined,
        "empty batch",
      ),
      detectResults: new Map(),
    };
  }

  return auditedCall(
    { provider: "enrich", operation: "runDetectPhase", kind: "service" },
    async () => {
  const { result, durationMs } = await timePhase(async () => {
    const detectItems: DetectBatchItem[] = ctx.chunk.map((brand, index) => {
      const probes = usableProbes(probeEvidence?.get(brand.id));
      return {
        slug: brand.slug,
        name: ctx.chunkBrandNames[index],
        description: brand.description ?? null,
        website: brand.purchase_website ?? null,
        snippets: searchResults.get(ctx.chunkBrandNames[index])?.snippets ?? [],
        ...(probes ? { probes } : {}),
        target: { type: ctx.targetType ?? "brand", id: brand.id },
      };
    });
    const outcome = await detectBrandsBatch(detectItems, ctx.jobId);
    const detectResults = outcome.results;
    const nonBrandCount = [...detectResults.values()].filter(
      (detectResult) => detectResult.isNonBrand,
    ).length;
    ctx.onProgress?.(
      `  [DETECT] OK — ${detectResults.size} results, ${nonBrandCount} non-brands`,
    );

    return { detectResults, nonBrandCount, calls: outcome.calls };
  });

  // Every detect call died at the provider: the empty result map says nothing
  // about these brands, so the phase must NOT report success. Reporting
  // `succeeded` here is precisely how 407 quota-blocked targets went green on
  // 2026-08-02 — an empty map read as "no non-brands found".
  if (isLlmProviderFailure(result.calls)) {
    ctx.onProgress?.(
      `  [DETECT] FAILED — every one of ${result.calls.attempted} call(s) failed at the provider`,
    );
    return {
      phaseResult: {
        ...buildPhaseResult(
          "detect",
          "failed",
          [],
          durationMs,
          `LLM provider failed all ${result.calls.attempted} detect call(s)`,
        ),
        providerFailure: true,
      },
      detectResults: result.detectResults,
    };
  }

  return {
    phaseResult: buildPhaseResult(
      "detect",
      "succeeded",
      result.nonBrandCount > 0 ? ["status"] : [],
      durationMs,
    ),
    detectResults: result.detectResults,
  };
    },
    {
      classify: (result) =>
        result.phaseResult.status === "failed" ? "failed" : "succeeded",
    },
  );
}

export async function runStandaloneClassification(
  ctx: BatchPhaseContext,
): Promise<{
  phaseResult: PhaseResult;
  batchClassifications: Map<string, ClassificationResult>;
}> {
  const shouldRun =
    ctx.phases.includes("tags") &&
    !ctx.phases.includes("descriptions") &&
    !ctx.phases.includes("detect") &&
    ctx.chunk.length > 0;

  if (!shouldRun) {
    return {
      phaseResult: buildPhaseResult(
        "tags",
        "skipped",
        [],
        0,
        undefined,
        "standalone classification not required",
      ),
      batchClassifications: new Map(),
    };
  }

  return auditedCall(
    { provider: "enrich", operation: "runStandaloneClassification", kind: "service" },
    async () => {
  const { result, durationMs } = await timePhase(async () => {
    const classifyItems: BatchClassificationItem[] = ctx.chunk.map((brand) => ({
      slug: brand.slug,
      name: getDisplayBrandName(brand),
      description: brand.description ?? null,
      target: { type: ctx.targetType ?? "brand", id: brand.id },
    }));
    const outcome = await classifyCategoryBatch(classifyItems, ctx.jobId);

    return outcome;
  });

  const batchClassifications = new Map(
    [...result.results].filter(
      ([, classification]) => classification.confidence === "high",
    ),
  );
  ctx.onProgress?.(
    `  [TAGS] OK — ${batchClassifications.size} accepted, ${result.results.size - batchClassifications.size} withheld`,
  );

  // Same rule as detect: an empty classification map from a dead account is not
  // "no category applies", it is "we never asked".
  if (isLlmProviderFailure(result.calls)) {
    ctx.onProgress?.(
      `  [TAGS] FAILED — every one of ${result.calls.attempted} call(s) failed at the provider`,
    );
    return {
      phaseResult: {
        ...buildPhaseResult(
          "tags",
          "failed",
          [],
          durationMs,
          `LLM provider failed all ${result.calls.attempted} classification call(s)`,
        ),
        providerFailure: true,
      },
      batchClassifications,
    };
  }

  return {
    phaseResult: buildPhaseResult(
      "tags",
      "succeeded",
      batchClassifications.size > 0 ? ["category"] : [],
      durationMs,
    ),
    batchClassifications,
  };
    },
    {
      classify: (result) =>
        result.phaseResult.status === "failed" ? "failed" : "succeeded",
    },
  );
}

export function applyDetectResult(
  detectResult: DetectResult | undefined,
  brand: EnrichBrand,
  phases: readonly string[] = DETECT_PHASES,
): {
  isNonBrand: boolean;
  phaseResult: PhaseResult;
  patch: EnrichPatch;
  /**
   * Raw `detected` candidate for the DEV-1321 names arbiter. Deliberately
   * unguarded — the arbiter and `isValidBrandName` are the guard now, and
   * pre-filtering here would hide a real disagreement from the model. `null`
   * when detect produced no name at all.
   */
  brandName: string | null;
} {
  if (shouldSkipForNonBrand(detectResult)) {
    return {
      isNonBrand: true,
      phaseResult: buildPhaseResult(
        "detect",
        "skipped",
        [],
        0,
        undefined,
        detectResult?.nonBrandReason ?? "non-brand",
      ),
      patch: {},
      // A rejected entry never reaches the names phase, so it contributes no
      // candidate.
      brandName: null,
    };
  }

  const patch = buildDetectPatch(brand, detectResult, phases);
  const changedFields = Object.keys(patch);

  return {
    isNonBrand: false,
    phaseResult: buildPhaseResult(
      "detect",
      detectResult ? "succeeded" : "skipped",
      changedFields,
      0,
      undefined,
      detectResult ? undefined : "no detect result",
    ),
    patch,
    brandName: detectResult?.brandName ?? null,
  };
}
