import type { Json } from "@/lib/supabase/database.types";
import type { Brand } from "@/lib/types";
import type { SubmissionReviewData } from "@/lib/services/submissions";

export function brandToReviewData(brand: Brand): SubmissionReviewData {
  return {
    name: brand.name,
    description: brand.description,
    descriptionEn: brand.descriptionEn,
    blurb: brand.blurb,
    blurbEn: brand.blurbEn,
    city: brand.city,
    categoryAttributes: null,
    reputationSummary: brand.reputationSummary as unknown as Json,
    mitEvidence: brand.mitEvidence as unknown as Json,
    siteContent: brand.siteContent as unknown as Json,
    foundingYear: brand.foundingYear,
    heroImageUrl: brand.heroImageUrl,
    productType: brand.productType ?? null,
    priceRange: brand.priceRange,
    productTags: brand.productTags,
    productTagsEn: brand.productTagsEn,
    websiteUrl: brand.purchaseWebsite,
    socialInstagram: brand.socialInstagram,
    socialThreads: brand.socialThreads,
    socialFacebook: brand.socialFacebook,
    purchaseWebsite: brand.purchaseWebsite,
    purchasePinkoi: brand.purchasePinkoi,
    purchaseShopee: brand.purchaseShopee,
    otherUrls: brand.otherUrls,
  };
}
