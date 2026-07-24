import type { Json } from "@/lib/supabase/database.types";
import type { OtherUrl } from "@/lib/types/brand";

export type EnrichedData = {
  description?: string;
  descriptionEn?: string;
  blurb?: string;
  blurbEn?: string;
  city?: string;
  categoryAttributes?: Json;
  reputationSummary?: Json;
  mitEvidence?: Json;
  siteContent?: Json;
  foundingYear?: number;
  heroImageUrl?: string;
  productType?: string;
  priceRange?: number;
  productTags?: string[];
  productTagsEn?: string[];
  socialInstagram?: string;
  socialThreads?: string;
  socialFacebook?: string;
  purchaseWebsite?: string;
  purchasePinkoi?: string;
  purchaseShopee?: string;
  otherUrls?: OtherUrl[];
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
    hasText(enrichedData.productType);

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
    ...(json.category_attributes !== undefined
      ? { categoryAttributes: json.category_attributes as Json }
      : {}),
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
    ...(typeof json.product_type === "string"
      ? { productType: json.product_type }
      : {}),
    ...(typeof json.price_range === "number"
      ? { priceRange: json.price_range }
      : {}),
    ...(Array.isArray(json.product_tags)
      ? { productTags: json.product_tags as string[] }
      : {}),
    ...(Array.isArray(json.product_tags_en)
      ? { productTagsEn: json.product_tags_en as string[] }
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
  if (data.categoryAttributes !== undefined)
    result.category_attributes = data.categoryAttributes;
  if (data.reputationSummary !== undefined)
    result.reputation_summary = data.reputationSummary;
  if (data.mitEvidence !== undefined) result.mit_evidence = data.mitEvidence;
  if (data.siteContent !== undefined) result.site_content = data.siteContent;
  if (data.foundingYear !== undefined) result.founding_year = data.foundingYear;
  if (data.name !== undefined) result.name = data.name;
  if (data.heroImageUrl !== undefined)
    result.hero_image_url = data.heroImageUrl;
  if (data.productType !== undefined) result.product_type = data.productType;
  if (data.priceRange !== undefined) result.price_range = data.priceRange;
  if (data.productTags !== undefined) result.product_tags = data.productTags;
  if (data.productTagsEn !== undefined)
    result.product_tags_en = data.productTagsEn;
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
  if (data.otherUrls !== undefined) result.other_urls = data.otherUrls;
  return result;
}
