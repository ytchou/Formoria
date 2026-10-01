// Pure helpers for the trail shortlist and apply-picks scripts. No I/O, no
// Supabase, no Next — everything here is exercised directly by lib.test.ts.

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export type TrailBriefSection = {
  key: string;
  title: string;
  query: string;
  subcategories: string[];
};

export type TrailBrief = {
  slug: string;
  sections: TrailBriefSection[];
};

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Validates a parsed `scripts/trails/briefs/<slug>.json`; throws on a bad shape. */
export function parseTrailBrief(raw: unknown): TrailBrief {
  if (!raw || typeof raw !== "object") throw new Error("Brief must be an object");
  const brief = raw as Record<string, unknown>;
  if (!isNonBlankString(brief.slug)) throw new Error("Brief needs a slug");
  if (!Array.isArray(brief.sections) || brief.sections.length === 0) {
    throw new Error("Brief needs at least one section");
  }

  const seen = new Set<string>();
  const sections = brief.sections.map((value, index) => {
    const section = (value ?? {}) as Record<string, unknown>;
    if (
      !isNonBlankString(section.key) ||
      !isNonBlankString(section.title) ||
      !isNonBlankString(section.query) ||
      !Array.isArray(section.subcategories) ||
      section.subcategories.length === 0 ||
      !section.subcategories.every(isNonBlankString)
    ) {
      throw new Error(
        `Brief section ${index} needs key, title, query and a non-empty subcategories[]`,
      );
    }
    if (seen.has(section.key)) {
      throw new Error(`Brief section key "${section.key}" is duplicated`);
    }
    seen.add(section.key);
    return {
      key: section.key,
      title: section.title,
      query: section.query,
      subcategories: section.subcategories as string[],
    };
  });

  return { slug: brief.slug, sections };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Columns `isTrailEligibleProduct` reads. Sources are a plain (not `!inner`)
 * embed so a product with no source row comes back and is refused here,
 * instead of silently disappearing from the result.
 */
export const TRAIL_ELIGIBILITY_SELECT =
  "id, key, visible, official_url, source_checked_at, subcategory, brands!inner(slug, status), curated_product_sources(state)";

export type TrailEligibilityRow = {
  visible: boolean | null;
  official_url: string | null;
  source_checked_at: string | null;
  subcategory: string | null;
  brands: { status: string | null } | null;
  curated_product_sources: readonly { state: string | null }[] | null;
};

/**
 * Product eligibility for a trail placement — the product half of the public
 * trail read (`getPublishedCuratedProductsForTrail`) without its selection
 * requirement, since a new trail has no placements yet.
 */
export function isTrailEligibleProduct(row: TrailEligibilityRow): boolean {
  return (
    row.visible === true &&
    isNonBlankString(row.official_url) &&
    row.source_checked_at !== null &&
    isNonBlankString(row.subcategory) &&
    row.brands?.status === "approved" &&
    (row.curated_product_sources ?? []).some(
      (source) => source.state === "active",
    )
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type ShortlistCandidate = {
  sectionKey: string;
  /** 1-based position in the retrieval (RRF) result. Lower is better. */
  rank: number;
  productId: string;
  productKey: string;
  brandSlug: string;
  brandName: string;
  name: string;
  subcategory: string;
  imageUrl: string | null;
  officialUrl: string | null;
  /** Optional prefill for the review sheet's note input. */
  note?: string;
};

export type ShortlistSection = TrailBriefSection & {
  candidates: ShortlistCandidate[];
};

/** The `candidates.json` written next to the review sheet. */
export type ShortlistCandidates = {
  trail: string;
  target: string;
  projectRef: string;
  generatedAt: string;
  sections: ShortlistSection[];
};

/**
 * D5: one product per brand within a section. Keeps the best-ranked product of
 * each brand per section; the same brand may appear in other sections. Output
 * is ordered by section first appearance, then rank.
 */
export function dedupeByBrandPerSection(
  candidates: readonly ShortlistCandidate[],
): ShortlistCandidate[] {
  const sectionOrder: string[] = [];
  const bySection = new Map<string, Map<string, ShortlistCandidate>>();

  for (const candidate of candidates) {
    let brands = bySection.get(candidate.sectionKey);
    if (!brands) {
      brands = new Map();
      bySection.set(candidate.sectionKey, brands);
      sectionOrder.push(candidate.sectionKey);
    }
    const kept = brands.get(candidate.brandSlug);
    if (!kept || candidate.rank < kept.rank) {
      brands.set(candidate.brandSlug, candidate);
    }
  }

  return sectionOrder.flatMap((key) =>
    [...bySection.get(key)!.values()].sort((a, b) => a.rank - b.rank),
  );
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export type PickRow = {
  sectionKey: string;
  brandSlug: string;
  productKey: string;
  note: string;
  checked: boolean;
};

export type TrailPick = { brandSlug: string; productKey: string; note: string };

export type TrailPicks = {
  trail: string;
  sections: Record<string, TrailPick[]>;
};

/**
 * The `picks.json` shape. The review sheet's inline export builds the same
 * object in the browser; keep the two in step.
 */
export function toPicksJson(trail: string, rows: readonly PickRow[]): TrailPicks {
  const sections: Record<string, TrailPick[]> = {};
  for (const row of rows) {
    if (!row.checked) continue;
    (sections[row.sectionKey] ??= []).push({
      brandSlug: row.brandSlug,
      productKey: row.productKey,
      note: row.note.trim(),
    });
  }
  return { trail, sections };
}
