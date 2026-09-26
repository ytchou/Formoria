/**
 * @formoria-script
 * purpose: Classify a brand's pipeline outcome into the eval taxonomy.
 * class: shared
 * invoke: pnpm exec tsx scripts/enrichment/eval/classify.ts
 * target: none
 * safety: read-only
 * owner: engineering
 */
import {
  type PhaseResultRow,
  acquirePhaseResult,
  phaseRows,
  productsPhaseResult,
} from "./trace-summary";

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export const OBSERVED = [
  "transient_infra_failure",
  "persistence_failure",
  "success_products",
  "render_required",
  "host_resolution_failure",
  "catalog_discovery_failure",
  "zero:no_catalog",
  "fetch_blocked",
  "validation_failure",
  "extraction_failure",
  "unsupported_source_shape",
  "zero:unclassified",
] as const;
export type Observed = (typeof OBSERVED)[number];

export const STAGES = [
  "infra",
  "persist",
  "products",
  "catalog",
  "verify",
] as const;
export type Stage = (typeof STAGES)[number];

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export type ClassifyInput = {
  targetRow: {
    status: string;
    error?: string;
    phase_results: unknown;
  } | null;
  jobStatus?: string;
  applyOutcome?: {
    applied?: Array<{ slug: string; ok: boolean; detail: string }>;
    rejected?: Array<{ slug: string; reason: string }>;
  };
};

export type ClassifyResult = {
  observed: Observed;
  stage: Stage;
  evidence: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numberField(record: unknown, key: string): number {
  if (typeof record !== "object" || record === null) return 0;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

function stringRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

const APPLY_FAILURE_PATTERN =
  /publishable core|Refresh is stale|successful enrichment run|Another update/i;

function hasProviderFailure(rows: PhaseResultRow[]): boolean {
  return rows.some(
    (r) =>
      r.providerFailure === true ||
      (typeof r.error === "string" &&
        (r.error.startsWith("Search provider unavailable") ||
          r.error.startsWith("LLM provider unavailable"))),
  );
}

// ---------------------------------------------------------------------------
// Classifier — 14 rules, first match wins
// ---------------------------------------------------------------------------

export function classify(input: ClassifyInput): ClassifyResult {
  const { targetRow, jobStatus, applyOutcome } = input;

  // Rule 1: no target row / job not completed / target cancelled
  if (
    !targetRow ||
    (jobStatus !== undefined && jobStatus !== "completed") ||
    targetRow.status === "cancelled"
  ) {
    return {
      observed: "transient_infra_failure",
      stage: "infra",
      evidence: [
        !targetRow
          ? "no target row"
          : targetRow.status === "cancelled"
            ? "target cancelled"
            : `job status: ${jobStatus ?? "unknown"}`,
      ],
    };
  }

  const rows = phaseRows(targetRow.phase_results);
  const acquire = acquirePhaseResult(targetRow.phase_results);
  const products = productsPhaseResult(targetRow.phase_results);

  // Rule 2: provider failure in any phase
  if (hasProviderFailure(rows)) {
    const failedPhases = rows
      .filter(
        (r) =>
          r.providerFailure === true ||
          (typeof r.error === "string" &&
            (r.error.startsWith("Search provider unavailable") ||
              r.error.startsWith("LLM provider unavailable"))),
      )
      .map((r) => r.phase);
    return {
      observed: "transient_infra_failure",
      stage: "infra",
      evidence: [`provider failure in: ${failedPhases.join(", ")}`],
    };
  }

  // Rule 3: apply attempted and failed
  if (applyOutcome) {
    const failedApplies = [
      ...(applyOutcome.applied ?? [])
        .filter((a) => !a.ok && APPLY_FAILURE_PATTERN.test(a.detail))
        .map((a) => a.detail),
      ...(applyOutcome.rejected ?? [])
        .filter((r) => APPLY_FAILURE_PATTERN.test(r.reason))
        .map((r) => r.reason),
    ];
    if (failedApplies.length > 0) {
      return {
        observed: "persistence_failure",
        stage: "persist",
        evidence: failedApplies,
      };
    }
  }

  const productsProposed = products?.productsProposed ?? 0;

  // Rule 4: products proposed but target skipped with "no new enrichment"
  if (
    productsProposed >= 1 &&
    targetRow.status === "skipped" &&
    typeof targetRow.error === "string" &&
    targetRow.error.includes("no new enrichment")
  ) {
    return {
      observed: "persistence_failure",
      stage: "persist",
      evidence: [
        `${productsProposed} products proposed but target skipped: ${targetRow.error}`,
      ],
    };
  }

  // Rule 5: products succeeded with proposals, apply ok or not attempted
  if (
    products?.status === "succeeded" &&
    productsProposed >= 1
  ) {
    return {
      observed: "success_products",
      stage: "products",
      evidence: [`${productsProposed} products proposed, products phase succeeded`],
    };
  }

  const catalogZeroReason = products?.catalogZeroReason ?? acquire?.catalogZeroReason;

  // Rule 6: render_blocked
  if (catalogZeroReason === "render_blocked") {
    return {
      observed: "render_required",
      stage: "catalog",
      evidence: ["catalogZeroReason: render_blocked"],
    };
  }

  // Rule 7: route_broken
  if (catalogZeroReason === "route_broken") {
    return {
      observed: "host_resolution_failure",
      stage: "catalog",
      evidence: ["catalogZeroReason: route_broken"],
    };
  }

  // Rule 8: truncated, acquire failed (non-provider), or the acquisition plan
  // aborted / was refused, cut off or filtered (model_*) with 0 proposals
  const acquisitionError = acquire?.acquisitionPlan?.error;
  const acquisitionStopped =
    acquisitionError === "aborted" || (acquisitionError?.startsWith("model_") ?? false);
  if (
    catalogZeroReason === "truncated" ||
    (acquire?.status === "failed" && !acquire.providerFailure) ||
    (acquisitionStopped && productsProposed === 0)
  ) {
    const reasons: string[] = [];
    if (catalogZeroReason === "truncated") reasons.push("catalogZeroReason: truncated");
    if (acquire?.status === "failed") reasons.push("acquire phase failed");
    if (acquisitionStopped) reasons.push(`acquisition ${acquisitionError}`);
    return {
      observed: "catalog_discovery_failure",
      stage: "catalog",
      evidence: reasons,
    };
  }

  // Rule 9: no_catalog
  if (catalogZeroReason === "no_catalog") {
    return {
      observed: "zero:no_catalog",
      stage: "catalog",
      evidence: ["catalogZeroReason: no_catalog"],
    };
  }

  // Rules 10-11 need productsVerification
  const verification = products?.productsVerification ?? {};
  const proposed = numberField(verification, "proposed");
  const verified = numberField(verification, "verified");
  const repaired = numberField(verification, "repaired");
  const dropReasons = stringRecord(
    (verification as Record<string, unknown>).dropReasons,
  );
  const dropReasonKeys = Object.keys(dropReasons);

  // Rule 10: fetch blocked — HTTP 403/429/503 or unreachable, verified+repaired = 0
  const fetchBlockedPatterns = [
    /^HTTP [45]\d\d$/i,
    /^unreachable$/i,
  ];
  if (
    dropReasonKeys.some((k) => fetchBlockedPatterns.some((p) => p.test(k))) &&
    verified + repaired === 0
  ) {
    return {
      observed: "fetch_blocked",
      stage: "verify",
      evidence: [
        `drop reasons: ${dropReasonKeys.join(", ")}; verified=${verified} repaired=${repaired}`,
      ],
    };
  }

  // Rule 11: validation failure — proposed > 0, verified+repaired = 0, non-empty dropReasons
  // Drop reason keys use spaces (e.g. "host mismatch"), not underscores — match case-insensitively
  const validationPatterns = [
    /^host.mismatch/i,
    /^closed.set/i,
    /^description/i,
    /^official.url.is.not/i,
  ];
  if (
    proposed > 0 &&
    verified + repaired === 0 &&
    dropReasonKeys.some((k) => validationPatterns.some((p) => p.test(k)))
  ) {
    return {
      observed: "validation_failure",
      stage: "verify",
      evidence: [
        `proposed=${proposed} but all dropped: ${dropReasonKeys.join(", ")}`,
      ],
    };
  }

  // Rule 12: extraction failure
  const productsAgentOutcome = products?.agentOutcome;
  const productsDetail = products?.detail ?? "";
  if (
    (products?.status === "failed" && !products.providerFailure) ||
    (productsAgentOutcome === "blocked" &&
      !productsDetail.includes("empty candidate pool")) ||
    (productsAgentOutcome === "fallback" &&
      (productsDetail.includes("aborted") ||
        productsDetail.includes("recursion_limit") ||
        productsDetail.includes("model_refused") ||
        productsDetail.includes("model_truncated") ||
        productsDetail.includes("model_filtered")) &&
      productsProposed === 0)
  ) {
    const reasons: string[] = [];
    if (products?.status === "failed") reasons.push("products phase failed");
    if (productsAgentOutcome === "blocked") reasons.push(`products blocked: ${productsDetail}`);
    if (productsAgentOutcome === "fallback") reasons.push(`products fallback: ${productsDetail}`);
    return {
      observed: "extraction_failure",
      stage: "products",
      evidence: reasons,
    };
  }

  // Rule 13: unsupported source shape — acquire produced surfaces, 0 proposals, fallback with no_proposals
  const surfaces = acquire?.acquisitionPlan?.surfaces?.length ?? 0;
  if (
    surfaces > 0 &&
    productsProposed === 0 &&
    productsAgentOutcome === "fallback" &&
    productsDetail.includes("no_proposals")
  ) {
    return {
      observed: "unsupported_source_shape",
      stage: "products",
      evidence: [
        `${surfaces} surfaces acquired, 0 proposals, fallback: ${productsDetail}`,
      ],
    };
  }

  // Rule 14: anything else with 0 proposals
  if (productsProposed === 0) {
    return {
      observed: "zero:unclassified",
      stage: "products",
      evidence: [
        `0 products proposed; acquire=${acquire?.status ?? "missing"} products=${products?.status ?? "missing"}`,
      ],
    };
  }

  // Fallback — should not be reached for well-formed data, but handle gracefully
  return {
    observed: "zero:unclassified",
    stage: "products",
    evidence: ["no classification rule matched"],
  };
}
