import type {
  EvaluatedFoundingFact,
  FoundingFactAction,
  FoundingFactField,
  FoundingFactSourceType,
  FoundingFactValue,
} from "@/lib/services/founding-facts";

export type FoundingFactsSourceAttempt = {
  url: string;
  sourceType: FoundingFactSourceType;
  reputable: boolean;
  discoveredBy: "known-link" | "search";
  fetched: boolean;
  text: string | null;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
};

export type FoundingFactsFieldAudit = {
  field: FoundingFactField;
  expectedCurrent: FoundingFactValue | null;
  protection: "protected:owner" | "protected:admin" | null;
  proposal: EvaluatedFoundingFact;
  action: FoundingFactAction;
  requiresDecision: boolean;
  humanOriginConflict: boolean;
};

export type FoundingFactsBrandAudit = {
  snapshot: {
    id: string;
    name: string;
    slug: string;
    status: string;
    city: FoundingFactValue | null;
    foundingYear: FoundingFactValue | null;
    seoPromoted: boolean;
  };
  sources: FoundingFactsSourceAttempt[];
  fields: {
    city: FoundingFactsFieldAudit;
    founding_year: FoundingFactsFieldAudit;
  };
};

export type FoundingFactsAuditArtifact = {
  version: 1;
  runId: string;
  createdAt: string;
  mode: "pilot" | "all";
  metrics: {
    approvedCount: number;
    cityPopulatedBefore: number;
    foundingYearPopulatedBefore: number;
    seoPromotedBefore: number;
    searchFailures: number;
    fetchFailures: number;
    serperCredits: number;
    llmCalls: number;
    llmCostUsd: number | null;
    llmUnpricedCalls: number;
  };
  brands: FoundingFactsBrandAudit[];
};

export type FoundingFactsDecision =
  "accept-proposal" | "retain-current" | "set-null";

export type FoundingFactsDecisionItem = {
  brandId: string;
  field: FoundingFactField;
  decision: FoundingFactsDecision;
  expectedCurrent: FoundingFactValue | null;
  evidenceHash: string;
};

export type FoundingFactsDecisionBundle = {
  version: 1;
  runId: string;
  exportedAt: string;
  decisions: FoundingFactsDecisionItem[];
};

export type FoundingFactsApplyItem = {
  brandId: string;
  field: FoundingFactField;
  expectedCurrent: FoundingFactValue | null;
  value: FoundingFactValue | null;
  evidenceHash: string;
  decision: FoundingFactsDecision | "auto-high";
};

function itemKey(brandId: string, field: FoundingFactField): string {
  return `${brandId}\u0000${field}`;
}

function sameValue(
  left: FoundingFactValue | null,
  right: FoundingFactValue | null,
): boolean {
  return left === right;
}

export function validateDecisionBundle(
  artifact: FoundingFactsAuditArtifact,
  bundle: FoundingFactsDecisionBundle,
): string[] {
  const errors: string[] = [];
  if (bundle.version !== 1) errors.push("unsupported decision bundle version");
  if (bundle.runId !== artifact.runId)
    errors.push("decision run ID does not match the audit artifact");

  const fieldByKey = new Map<string, FoundingFactsFieldAudit>();
  for (const brand of artifact.brands) {
    fieldByKey.set(itemKey(brand.snapshot.id, "city"), brand.fields.city);
    fieldByKey.set(
      itemKey(brand.snapshot.id, "founding_year"),
      brand.fields.founding_year,
    );
  }

  const seen = new Set<string>();
  for (const decision of bundle.decisions) {
    const key = itemKey(decision.brandId, decision.field);
    const label = `${decision.brandId}.${decision.field}`;
    if (seen.has(key)) {
      errors.push(`${label} has duplicate decisions`);
      continue;
    }
    seen.add(key);
    const audited = fieldByKey.get(key);
    if (!audited) {
      errors.push(`${label} was not audited in this run`);
      continue;
    }
    if (!audited.requiresDecision)
      errors.push(`${label} does not require a review decision`);
    if (!sameValue(decision.expectedCurrent, audited.expectedCurrent))
      errors.push(`${label} expected current value does not match`);
    if (decision.evidenceHash !== audited.proposal.evidenceHash)
      errors.push(`${label} evidence hash does not match`);
    if (
      decision.decision === "accept-proposal" &&
      audited.proposal.value == null
    ) {
      errors.push(`${label} has no proposal to accept`);
    }
  }

  for (const brand of artifact.brands) {
    for (const field of ["city", "founding_year"] as const) {
      if (
        brand.fields[field].requiresDecision &&
        !seen.has(itemKey(brand.snapshot.id, field))
      ) {
        errors.push(
          `${brand.snapshot.id}.${field} is missing a review decision`,
        );
      }
    }
  }

  return errors;
}

export function buildDecisionApplyPlan(
  artifact: FoundingFactsAuditArtifact,
  bundle: FoundingFactsDecisionBundle,
): FoundingFactsApplyItem[] {
  const errors = validateDecisionBundle(artifact, bundle);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const fieldByKey = new Map<string, FoundingFactsFieldAudit>();
  for (const brand of artifact.brands) {
    fieldByKey.set(itemKey(brand.snapshot.id, "city"), brand.fields.city);
    fieldByKey.set(
      itemKey(brand.snapshot.id, "founding_year"),
      brand.fields.founding_year,
    );
  }

  return bundle.decisions.flatMap((decision) => {
    if (decision.decision === "retain-current") return [];
    const audited = fieldByKey.get(itemKey(decision.brandId, decision.field));
    if (!audited) return [];
    return [
      {
        brandId: decision.brandId,
        field: decision.field,
        expectedCurrent: decision.expectedCurrent,
        value: decision.decision === "set-null" ? null : audited.proposal.value,
        evidenceHash: decision.evidenceHash,
        decision: decision.decision,
      } satisfies FoundingFactsApplyItem,
    ];
  });
}

export function buildAutoHighApplyPlan(
  artifact: FoundingFactsAuditArtifact,
): FoundingFactsApplyItem[] {
  return artifact.brands.flatMap((brand) =>
    (["city", "founding_year"] as const).flatMap((field) => {
      const audited = brand.fields[field];
      if (
        audited.protection ||
        audited.proposal.confidence !== "high" ||
        audited.proposal.value == null ||
        (audited.action !== "fill" && audited.action !== "correct")
      ) {
        return [];
      }
      return [
        {
          brandId: brand.snapshot.id,
          field,
          expectedCurrent: audited.expectedCurrent,
          value: audited.proposal.value,
          evidenceHash: audited.proposal.evidenceHash,
          decision: "auto-high",
        } satisfies FoundingFactsApplyItem,
      ];
    }),
  );
}
