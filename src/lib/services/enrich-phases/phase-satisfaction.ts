import type { EnrichPhaseName } from "@/lib/constants/enrich-phases";

/**
 * Three-state satisfaction result. `unknown` is distinct from both `satisfied`
 * and `unsatisfied`: it means the phase has no durable, distinguishable output
 * that we can check (e.g. `clean` mutates the brand name in place, and
 * `site_identity` signals by the *absence* of a value). Callers must treat
 * `unknown` as unsatisfied — the phase must run — but the distinction lets
 * logging report *why* it ran.
 */
export type SatisfactionResult = "satisfied" | "unsatisfied" | "unknown";

/**
 * The injected data a predicate inspects. No Supabase client: the caller
 * fetches once and passes the snapshot. All fields are nullable because a cold
 * brand may have none of them.
 */
export type PhaseSatisfactionData = {
  brand: {
    purchase_website: string | null;
    website: string | null;
    description: string | null;
    founding_year: number | null;
  };
  submission: {
    enriched_data: Record<string, unknown> | null;
  };
  /** Count of `brand_images` rows for this brand. */
  brandImagesCount: number;
};

type Predicate = (data: PhaseSatisfactionData) => SatisfactionResult;

function hasEnrichedField(
  data: PhaseSatisfactionData,
  field: string,
): boolean {
  const ed = data.submission.enriched_data;
  if (!ed) return false;
  const value = ed[field];
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

const PREDICATES: Partial<Record<EnrichPhaseName, Predicate>> = {
  links: (data) => {
    const hasLink = Boolean(
      data.brand.purchase_website || data.brand.website,
    );
    return hasLink ? "satisfied" : "unsatisfied";
  },

  images: (data) => {
    return data.brandImagesCount > 0 ? "satisfied" : "unsatisfied";
  },

  products: (data) => {
    return hasEnrichedField(data, "products") ? "satisfied" : "unsatisfied";
  },

  descriptions: (data) => {
    return data.brand.description ? "satisfied" : "unsatisfied";
  },

  reputation: (data) => {
    return hasEnrichedField(data, "reputationSummary")
      ? "satisfied"
      : "unsatisfied";
  },

  tags: (data) => {
    return hasEnrichedField(data, "primaryCategorySlug")
      ? "satisfied"
      : "unsatisfied";
  },

  faq: (data) => {
    return hasEnrichedField(data, "faq") ? "satisfied" : "unsatisfied";
  },

  locations: () => "unsatisfied",
};

/**
 * Check whether a phase's output is already present (satisfied), definitely
 * missing (unsatisfied), or unknowable from persisted data (unknown).
 *
 * When `force` is true every predicate returns `unsatisfied`, so all phases
 * will re-run regardless of existing data.
 */
export function checkPhaseSatisfaction(
  phase: EnrichPhaseName,
  data: PhaseSatisfactionData,
  force?: boolean,
): SatisfactionResult {
  if (force) return "unsatisfied";

  const predicate = PREDICATES[phase];
  if (!predicate) return "unknown";

  return predicate(data);
}

export type PhaseSkipEntry = {
  phase: EnrichPhaseName;
  reason: "satisfied";
};

/**
 * Filters a list of resolved phases, removing those whose satisfaction
 * predicate holds. Returns the phases to execute and a list of skipped
 * phases with their skip reason (distinguishable from "not requested").
 */
export function filterSatisfiedPhases(
  phases: readonly EnrichPhaseName[],
  data: PhaseSatisfactionData,
  force?: boolean,
): { execute: EnrichPhaseName[]; skipped: PhaseSkipEntry[] } {
  const execute: EnrichPhaseName[] = [];
  const skipped: PhaseSkipEntry[] = [];

  for (const phase of phases) {
    const result = checkPhaseSatisfaction(phase, data, force);
    if (result === "satisfied") {
      skipped.push({ phase, reason: "satisfied" });
    } else {
      execute.push(phase);
    }
  }

  return { execute, skipped };
}
