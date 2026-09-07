import type { Json } from "@/lib/supabase/database.types";
import type { OtherUrl } from "@/lib/types/brand";
import { subcategoryBySlug } from "@/lib/taxonomy/ontology";
import { FAQ_PRESETS } from "@/lib/brands/faq-presets";

/**
 * One provenance citation on a proposed product. Mirrors
 * `curatedProductSourceSchema` in `@/lib/validation/curated-product` minus its
 * `id` — a proposal has no row yet — and stays a plain type rather than a second
 * schema, so the bounds and the `source_type` CHECK list keep exactly one owner.
 */
export type CuratedProductProposalSource = {
  url: string;
  /** One of `CURATED_PRODUCT_SOURCE_TYPES`; the enum is enforced at validation. */
  sourceType: string;
  claimZh?: string;
};

/**
 * One product an enrichment run proposes from the brand's own site. Proposals
 * ride the submission's `enriched_data` blob until a moderator ticks the keepers
 * in the existing submission review; approval is what materializes
 * `curated_products` rows.
 *
 * Shaped like `channels`: the blob's TOP-LEVEL keys are snake_case, its object
 * arrays are camelCase passthrough. No per-item key transform in either
 * direction, so a round trip is lossless by construction.
 *
 * NO COMMERCE TRUTH, ever: no price, stock, inventory, discount, availability,
 * offer or variant field. Anything a transaction or an inventory event can
 * change is linked to through `officialUrl` instead of copied here.
 *
 * No gifting and no customization field either — DEV-1506 ruled there is no such
 * facet at any taxonomy level, so a proposal has nowhere to put one.
 */
export type CuratedProductProposal = {
  /** Stable within one brand; becomes `curated_products.key`. */
  key: string;
  nameZh: string;
  nameEn?: string;
  /** L1 category slug. */
  category: string;
  subcategory: string | null;
  /**
   * Slugs from the closed `MATERIALS` vocabulary. Deliberately `string[]` and
   * not the union: this is a wire payload, and the vocabulary check belongs to
   * the enrichment phase and the service that writes the rows, not to a type
   * that only describes what a JSONB blob may hold.
   */
  material: string[];
  officialUrl: string;
  /** The page an image was taken from, kept so usage rights stay re-checkable. */
  imageSourceUrl?: string;
  /** The one editorial text field a curated product carries (DEV-1496). */
  productDescriptionZh: string;
  sources: CuratedProductProposalSource[];
  madeInTaiwanConfirmed?: boolean;
  materialsFromTaiwanConfirmed?: boolean;
  mitRegistryId?: number | null;
  originCandidateId?: string | null;
};

export type BrandNameEvidence = {
  source: "official_website" | "official_social";
  url: string;
  observedName: string;
};

export type BrandNameProposal = {
  value: string;
  confidence: "high";
  reason: string;
  evidence: BrandNameEvidence[];
};

type SubmissionFaqEntry = {
  presetId: string;
  position?: number;
  questionZh?: string | null;
  answerZh?: string | null;
  questionEn?: string | null;
  answerEn?: string | null;
};

export type SubmissionFaqPatch = {
  entries: SubmissionFaqEntry[];
  explicit: boolean;
};

/**
 * The enriched_data.faq blob is the only door into brand_faq_entries; the
 * materializer reads it at apply/approve time and writes the rows then.
 */
export type EnrichedData = {
  description?: string;
  descriptionEn?: string;
  blurb?: string;
  blurbEn?: string;
  city?: string;
  reputationSummary?: Json;
  siteContent?: Json;
  foundingYear?: number;
  heroImageUrl?: string;
  categorySlug?: string;
  subcategories?: string[];
  subcategoriesEn?: string[];
  socialInstagram?: string;
  socialThreads?: string;
  socialFacebook?: string;
  purchaseWebsite?: string;
  purchasePinkoi?: string;
  purchaseShopee?: string;
  purchaseMyship?: string;
  otherUrls?: OtherUrl[];
  /**
   * Curated-product proposals from the enrichment run (DEV-1469). Absent means
   * "this run proposed nothing about products"; an empty array is a different
   * statement and no transform invents one.
   */
  products?: CuratedProductProposal[];
  name?: string;
  /** Refresh-only proposal; never part of the automatic review baseline. */
  nameProposal?: BrandNameProposal;
  /** FAQ entries proposed by enrichment; materialized at apply/approve time. */
  faq?: SubmissionFaqPatch;
};

export function isBrandNameProposal(value: unknown): value is BrandNameProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proposal = value as Record<string, unknown>;
  if (
    typeof proposal.value !== "string" ||
    proposal.value.trim() === "" ||
    proposal.confidence !== "high" ||
    typeof proposal.reason !== "string" ||
    !Array.isArray(proposal.evidence) ||
    proposal.evidence.length === 0
  ) {
    return false;
  }
  return proposal.evidence.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    const evidence = entry as Record<string, unknown>;
    return (
      (evidence.source === "official_website" ||
        evidence.source === "official_social") &&
      typeof evidence.url === "string" &&
      evidence.url.trim() !== "" &&
      typeof evidence.observedName === "string" &&
      evidence.observedName.trim() !== ""
    );
  });
}

const FAQ_PRESET_IDS = new Set(FAQ_PRESETS.map((preset) => preset.id));

export function parseSubmissionFaqPatch(
  value: unknown,
): SubmissionFaqPatch | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    return null;
  }
  const entries: SubmissionFaqEntry[] = [];
  for (const raw of obj.entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.presetId !== "string" || !FAQ_PRESET_IDS.has(entry.presetId)) {
      continue;
    }
    const position =
      typeof entry.position === "number" ? entry.position : 0;
    if (!Number.isInteger(position) || position < 0) continue;
    const questionZh =
      typeof entry.questionZh === "string"
        ? entry.questionZh
        : entry.questionZh === null
          ? null
          : undefined;
    const answerZh =
      typeof entry.answerZh === "string"
        ? entry.answerZh
        : entry.answerZh === null
          ? null
          : undefined;
    const questionEn =
      typeof entry.questionEn === "string"
        ? entry.questionEn
        : entry.questionEn === null
          ? null
          : undefined;
    const answerEn =
      typeof entry.answerEn === "string"
        ? entry.answerEn
        : entry.answerEn === null
          ? null
          : undefined;
    const parsed: SubmissionFaqEntry = { presetId: entry.presetId, position };
    if (questionZh !== undefined) parsed.questionZh = questionZh;
    if (answerZh !== undefined) parsed.answerZh = answerZh;
    if (questionEn !== undefined) parsed.questionEn = questionEn;
    if (answerEn !== undefined) parsed.answerEn = answerEn;
    entries.push(parsed);
  }
  if (entries.length === 0) return null;
  return {
    entries,
    explicit: typeof obj.explicit === "boolean" ? obj.explicit : false,
  };
}

function adaptProductProposal(value: unknown): CuratedProductProposal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const proposal = value as Record<string, unknown>;
  const category =
    typeof proposal.category === "string" ? proposal.category : "";
  const scalar =
    typeof proposal.subcategory === "string"
      ? proposal.subcategory
      : proposal.subcategory === null
        ? null
        : null;
  const legacy = Array.isArray(proposal.subcategories)
    ? proposal.subcategories.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const candidate = scalar ?? (legacy.length === 1 ? legacy[0]! : null);
  const node = candidate ? subcategoryBySlug(candidate) : null;
  const { subcategories: _legacySubcategories, ...rest } = proposal;
  return {
    ...(rest as unknown as CuratedProductProposal),
    subcategory: node?.category === category ? node.slug : null,
  };
}

type EnrichmentCompleteness = "none" | "partial" | "complete";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function getEnrichmentCompleteness(
  enrichedData: EnrichedData | null | undefined,
  heroImageUrl?: string | null,
): EnrichmentCompleteness {
  if (!enrichedData) {
    return hasText(heroImageUrl) ? "partial" : "none";
  }

  const complete =
    hasText(enrichedData.description) &&
    (hasText(enrichedData.heroImageUrl) || hasText(heroImageUrl)) &&
    hasText(enrichedData.categorySlug);

  if (complete) return "complete";
  return "partial";
}

export function hasCompleteEnrichment(
  enrichedData: EnrichedData | null | undefined,
  heroImageUrl?: string | null,
): boolean {
  return getEnrichmentCompleteness(enrichedData, heroImageUrl) === "complete";
}

// ---------------------------------------------------------------------------
// Service boundary transforms — convert between camelCase (TypeScript domain)
// and snake_case (DB JSONB keys).
// ---------------------------------------------------------------------------

export function enrichedDataFromDb(
  json: Record<string, unknown>,
): EnrichedData {
  return {
    ...(typeof json.description === "string"
      ? { description: json.description }
      : {}),
    ...(typeof json.description_en === "string"
      ? { descriptionEn: json.description_en }
      : {}),
    ...(typeof json.blurb === "string" ? { blurb: json.blurb } : {}),
    ...(typeof json.blurb_en === "string" ? { blurbEn: json.blurb_en } : {}),
    ...(typeof json.city === "string" ? { city: json.city } : {}),
    ...(json.reputation_summary !== undefined
      ? { reputationSummary: json.reputation_summary as Json }
      : {}),
    ...(json.site_content !== undefined
      ? { siteContent: json.site_content as Json }
      : {}),
    ...(typeof json.founding_year === "number"
      ? { foundingYear: json.founding_year }
      : {}),
    ...(typeof json.name === "string" ? { name: json.name } : {}),
    ...(isBrandNameProposal(json._name_proposal)
      ? { nameProposal: json._name_proposal }
      : {}),
    ...(typeof json.hero_image_url === "string"
      ? { heroImageUrl: json.hero_image_url }
      : {}),
    ...(typeof json.category === "string"
      ? { categorySlug: json.category }
      : {}),
    ...(Array.isArray(json.subcategories)
      ? { subcategories: json.subcategories as string[] }
      : {}),
    ...(Array.isArray(json.subcategories_en)
      ? { subcategoriesEn: json.subcategories_en as string[] }
      : {}),
    ...(typeof json.social_instagram === "string"
      ? { socialInstagram: json.social_instagram }
      : {}),
    ...(typeof json.social_threads === "string"
      ? { socialThreads: json.social_threads }
      : {}),
    ...(typeof json.social_facebook === "string"
      ? { socialFacebook: json.social_facebook }
      : {}),
    ...(typeof json.purchase_website === "string"
      ? { purchaseWebsite: json.purchase_website }
      : {}),
    ...(typeof json.purchase_pinkoi === "string"
      ? { purchasePinkoi: json.purchase_pinkoi }
      : {}),
    ...(typeof json.purchase_shopee === "string"
      ? { purchaseShopee: json.purchase_shopee }
      : {}),
    ...(typeof json.purchase_myship === "string"
      ? { purchaseMyship: json.purchase_myship }
      : {}),
    ...(Array.isArray(json.products)
      ? {
          products: json.products
            .map(adaptProductProposal)
            .filter(
              (proposal): proposal is CuratedProductProposal =>
                proposal !== null,
            ),
        }
      : {}),
    ...(Array.isArray(json.other_urls)
      ? {
          otherUrls: json.other_urls.filter(
            (value): value is OtherUrl =>
              typeof value === "object" &&
              value !== null &&
              typeof (value as Partial<OtherUrl>).label === "string" &&
              typeof (value as Partial<OtherUrl>).url === "string",
          ),
        }
      : {}),
    ...(json.faq !== undefined
      ? (() => {
          const parsed = parseSubmissionFaqPatch(json.faq);
          return parsed ? { faq: parsed } : {};
        })()
      : {}),
  };
}

export function enrichedDataToDb(data: EnrichedData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (data.description !== undefined) result.description = data.description;
  if (data.descriptionEn !== undefined)
    result.description_en = data.descriptionEn;
  if (data.blurb !== undefined) result.blurb = data.blurb;
  if (data.blurbEn !== undefined) result.blurb_en = data.blurbEn;
  if (data.city !== undefined) result.city = data.city;
  if (data.reputationSummary !== undefined)
    result.reputation_summary = data.reputationSummary;
  if (data.siteContent !== undefined) result.site_content = data.siteContent;
  if (data.foundingYear !== undefined) result.founding_year = data.foundingYear;
  if (data.name !== undefined) result.name = data.name;
  if (data.nameProposal !== undefined) result._name_proposal = data.nameProposal;
  if (data.heroImageUrl !== undefined)
    result.hero_image_url = data.heroImageUrl;
  if (data.categorySlug !== undefined) result.category = data.categorySlug;
  if (data.subcategories !== undefined)
    result.subcategories = data.subcategories;
  if (data.subcategoriesEn !== undefined)
    result.subcategories_en = data.subcategoriesEn;
  if (data.socialInstagram !== undefined)
    result.social_instagram = data.socialInstagram;
  if (data.socialThreads !== undefined)
    result.social_threads = data.socialThreads;
  if (data.socialFacebook !== undefined)
    result.social_facebook = data.socialFacebook;
  if (data.purchaseWebsite !== undefined)
    result.purchase_website = data.purchaseWebsite;
  if (data.purchasePinkoi !== undefined)
    result.purchase_pinkoi = data.purchasePinkoi;
  if (data.purchaseShopee !== undefined)
    result.purchase_shopee = data.purchaseShopee;
  if (data.purchaseMyship !== undefined)
    result.purchase_myship = data.purchaseMyship;
  if (data.otherUrls !== undefined) result.other_urls = data.otherUrls;
  if (data.products !== undefined) result.products = data.products;
  if (data.faq !== undefined) result.faq = data.faq;
  return result;
}
