import { createHash } from "node:crypto";
import { CITY_SLUGS, type CitySlug } from "@/lib/constants/taiwan-cities";

export type FoundingFactField = "city" | "founding_year";
export type FoundingFactValue = CitySlug | number;
export type FoundingFactSourceType =
  "first-party" | "independent" | "search-snippet";
export type FoundingLocationContext =
  | "founding"
  | "headquarters"
  | "contact"
  | "studio"
  | "store"
  | "current"
  | "unclear";

type FoundingFactVerification = {
  passed: boolean;
  reason: string | null;
};

/** One source-addressable claim produced by extraction and checked by verification. */
export type FoundingFactClaim = {
  field: FoundingFactField;
  value: string | number;
  citedUrl: string;
  exactExcerpt: string;
  sourceText: string | null;
  sourceType: FoundingFactSourceType;
  /** Deterministic source classification supplied by code, never by the model. */
  reputable: boolean;
  verification: FoundingFactVerification;
  locationContext: FoundingLocationContext;
};

type FoundingFactConfidence = "high" | "medium" | "none";

export type EvaluatedFoundingFact = {
  field: FoundingFactField;
  value: FoundingFactValue | null;
  confidence: FoundingFactConfidence;
  evidence: FoundingFactClaim[];
  conflicts: FoundingFactValue[];
  rejections: string[];
  evidenceHash: string;
};

export type FoundingFactAction =
  "fill" | "correct" | "verify" | "review" | "unresolved";

const CITY_SLUG_SET = new Set<string>(CITY_SLUGS);
const REJECTED_CITY_CONTEXTS = new Set<FoundingLocationContext>([
  "headquarters",
  "contact",
  "studio",
  "store",
  "current",
]);

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function normalizedValue(
  field: FoundingFactField,
  value: string | number,
  currentYear: number,
): FoundingFactValue | null {
  if (field === "city") {
    return typeof value === "string" && CITY_SLUG_SET.has(value)
      ? (value as CitySlug)
      : null;
  }

  const year = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(year) && year >= 1800 && year <= currentYear
    ? year
    : null;
}

function rejectionReason(
  field: FoundingFactField,
  claim: FoundingFactClaim,
  currentYear: number,
): string | null {
  if (claim.field !== field) return "wrong-field";
  if (!claim.verification.passed) return "verification-failed";
  if (!claim.citedUrl.trim() || !domainOf(claim.citedUrl)) return "invalid-url";
  if (!claim.exactExcerpt.trim()) return "missing-excerpt";
  if (normalizedValue(field, claim.value, currentYear) == null)
    return field === "city" ? "invalid-city" : "invalid-year";
  if (field === "city" && REJECTED_CITY_CONTEXTS.has(claim.locationContext))
    return "not-founding-location";

  if (claim.sourceType !== "search-snippet") {
    if (!claim.sourceText?.trim()) return "missing-source-text";
    if (
      !normalizedText(claim.sourceText).includes(
        normalizedText(claim.exactExcerpt),
      )
    ) {
      return "excerpt-not-found";
    }
  }

  return null;
}

function hashEvaluation(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Calculates confidence from verified evidence. The model never assigns a
 * confidence label: it only proposes claims and verifies whether each excerpt
 * supports the claim.
 */
export function evaluateFoundingFact(
  field: FoundingFactField,
  claims: readonly FoundingFactClaim[],
  currentYear = new Date().getUTCFullYear(),
): EvaluatedFoundingFact {
  const rejections: string[] = [];
  const accepted: Array<{
    claim: FoundingFactClaim;
    value: FoundingFactValue;
  }> = [];

  for (const candidate of claims) {
    const rejection = rejectionReason(field, candidate, currentYear);
    if (rejection) {
      rejections.push(rejection);
      continue;
    }
    const value = normalizedValue(field, candidate.value, currentYear);
    if (value != null) accepted.push({ claim: candidate, value });
  }

  const groups = new Map<
    string,
    { value: FoundingFactValue; claims: FoundingFactClaim[] }
  >();
  for (const item of accepted) {
    const key = String(item.value);
    const group = groups.get(key) ?? { value: item.value, claims: [] };
    group.claims.push(item.claim);
    groups.set(key, group);
  }

  const ranked = [...groups.values()].sort((left, right) => {
    const leftFirstParty = left.claims.some(
      (candidate) => candidate.sourceType === "first-party",
    );
    const rightFirstParty = right.claims.some(
      (candidate) => candidate.sourceType === "first-party",
    );
    return (
      Number(rightFirstParty) - Number(leftFirstParty) ||
      right.claims.length - left.claims.length
    );
  });
  const selected = ranked.at(0) ?? null;
  const conflicts = ranked.slice(1).map((group) => group.value);

  let confidence: FoundingFactConfidence = "none";
  if (selected) {
    const explicitFirstParty = selected.claims.some(
      (candidate) =>
        candidate.sourceType === "first-party" &&
        (field === "founding_year" || candidate.locationContext === "founding"),
    );
    const independentDomains = new Set(
      selected.claims
        .filter(
          (candidate) =>
            candidate.sourceType === "independent" && candidate.reputable,
        )
        .map((candidate) => domainOf(candidate.citedUrl))
        .filter((domain): domain is string => domain != null),
    );
    confidence =
      conflicts.length === 0 &&
      (explicitFirstParty || independentDomains.size >= 2)
        ? "high"
        : "medium";
  }

  const result = {
    field,
    value: selected?.value ?? null,
    confidence,
    evidence: selected?.claims ?? [],
    conflicts,
    rejections: [...new Set(rejections)],
  };

  return {
    ...result,
    evidenceHash: hashEvaluation({
      field: result.field,
      value: result.value,
      confidence: result.confidence,
      evidence: result.evidence,
      conflicts: result.conflicts,
    }),
  };
}

export function deriveFoundingFactAction(
  evaluated: EvaluatedFoundingFact,
  currentValue: FoundingFactValue | null,
  protection: "protected:owner" | "protected:admin" | null,
): FoundingFactAction {
  if (evaluated.confidence === "high" && evaluated.value === currentValue)
    return "verify";
  if (protection) return "review";
  if (evaluated.confidence === "high" && evaluated.value != null)
    return currentValue == null ? "fill" : "correct";
  if (evaluated.value != null || currentValue != null) return "review";
  return "unresolved";
}

/** The only value ordinary enrichment may expose to a canonical write patch. */
export function acceptedFoundingFactValue(
  evaluated: EvaluatedFoundingFact,
): FoundingFactValue | null {
  return evaluated.confidence === "high" ? evaluated.value : null;
}
