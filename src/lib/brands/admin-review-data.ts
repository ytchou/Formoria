import type { Json } from "@/lib/supabase/database.types";
import type { AdminBrandListItem } from "@/lib/brands/contracts";
import type { SubmissionReviewData } from "@/lib/services/submissions";

export function brandToReviewData(
  brand: AdminBrandListItem,
): SubmissionReviewData {
  return {
    name: brand.name,
    description: brand.description ?? null,
    descriptionEn: brand.descriptionEn ?? null,
    blurb: brand.blurb ?? null,
    blurbEn: brand.blurbEn ?? null,
    city: brand.city ?? null,
    reputationSummary: (brand.reputationSummary ?? null) as unknown as Json,
    siteContent: (brand.siteContent ?? null) as unknown as Json,
    foundingYear: brand.foundingYear ?? null,
    heroImageUrl: brand.heroImageUrl ?? null,
    categorySlug: brand.categorySlug ?? null,
    subcategories: brand.subcategories ?? [],
    subcategoriesEn: brand.subcategoriesEn ?? [],
    websiteUrl: brand.purchaseWebsite ?? null,
    socialInstagram: brand.socialInstagram ?? null,
    socialThreads: brand.socialThreads ?? null,
    socialFacebook: brand.socialFacebook ?? null,
    // Spelled out per store rather than built with Object.fromEntries: the
    // latter widens to a string index signature, which does not satisfy
    // SubmissionReviewData's required purchase keys. Listing them keeps tsc as
    // the gate — adding a store to ONLINE_STORES breaks this literal.
    purchaseWebsite: brand.purchaseWebsite ?? null,
    purchasePinkoi: brand.purchasePinkoi ?? null,
    purchaseShopee: brand.purchaseShopee ?? null,
    purchaseMyship: brand.purchaseMyship ?? null,
    otherUrls: brand.otherUrls ?? [],
  };
}
