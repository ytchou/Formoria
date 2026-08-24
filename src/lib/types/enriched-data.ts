import type { Json } from "@/lib/supabase/database.types";
import type { OtherUrl } from "@/lib/types/brand";

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
  subcategories: string[];
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
};

/**
 * FAQ deliberately has no field here. The dedicated `faq` phase writes
 * `brand_faq_entries` directly, behind the preset validators; carrying a copy
 * on this blob would be a second, unvalidated write door into the same table.
 */
export type EnrichedData = {
  description?: string;
  descriptionEn?: string;
  blurb?: string;
  blurbEn?: string;
  city?: string;
  reputationSummary?: Json;
  mitEvidence?: Json;
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
};

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
    ...(json.mit_evidence !== undefined
      ? { mitEvidence: json.mit_evidence as Json }
      : {}),
    ...(json.site_content !== undefined
      ? { siteContent: json.site_content as Json }
      : {}),
    ...(typeof json.founding_year === "number"
      ? { foundingYear: json.founding_year }
      : {}),
    ...(typeof json.name === "string" ? { name: json.name } : {}),
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
      ? { products: json.products as CuratedProductProposal[] }
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
  if (data.mitEvidence !== undefined) result.mit_evidence = data.mitEvidence;
  if (data.siteContent !== undefined) result.site_content = data.siteContent;
  if (data.foundingYear !== undefined) result.founding_year = data.foundingYear;
  if (data.name !== undefined) result.name = data.name;
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
  return result;
}
