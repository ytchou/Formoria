import type {
  Brand,
  BrandImageMeta,
  OtherUrl,
  ReputationSummary,
} from "@/lib/types/brand";

/** Purchase links are intentionally spelled out at every public boundary. */
type PublicPurchaseLinks = {
  purchaseWebsite: string | null;
  purchasePinkoi: string | null;
  purchaseShopee: string | null;
  purchaseMyship: string | null;
};

export type PublicBrandCard = {
  id: string;
  name: string;
  slug: string;
  romanizedName?: string | null;
  description: string | null;
  descriptionEn: string | null;
  blurb: string | null;
  blurbEn: string | null;
  heroImageUrl: string | null;
  logoUrl: string | null;
  status: "approved" | "hidden";
  categorySlug?: string | null;
  categoryLabel: string | null;
  subcategories: string[];
  subcategoriesEn: string[];
  foundingYear: number | null;
  productPhotos: string[];
  imageAlts: BrandImageMeta[];
  heroImageMetadata: Brand["heroImageMetadata"];
};

export type PublicBrandDetail = PublicBrandCard &
  PublicPurchaseLinks & {
    city: string | null;
    socialInstagram: string | null;
    socialThreads: string | null;
    socialFacebook: string | null;
    otherUrls: OtherUrl[];
    imageAlts: BrandImageMeta[];
    heroImageMetadata: Brand["heroImageMetadata"];
  };

export type SearchSuggestion = {
  id: string;
  slug: string;
  name: string;
  categoryLabel: string;
};

/**
 * Evidence available to render the public FAQ floors. This is intentionally
 * separate from both the public detail contract and the internal Brand row:
 * the detail route fetches it with its own projection and never serializes it.
 */
export type PublicBrandFaqContext = {
  name: string;
  categoryLabel: string | null;
  city: string | null;
  categorySlug?: string | null;
  subcategories: string[];
  subcategoriesEn: string[];
  foundingYear: number | null;
  reputationSummary?: ReputationSummary | null;
  material?: string[];
  purchaseWebsite?: string | null;
  purchasePinkoi?: string | null;
  purchaseShopee?: string | null;
  purchaseMyship?: string | null;
  stockistCount?: number;
};

export type AdminBrandListItem = {
  id: string;
  name: string;
  slug: string;
  status: "approved" | "hidden";
  isDemo: boolean;
  categoryLabel: string | null;
  createdAt: string;
  updatedAt: string;
  description?: string | null;
  descriptionEn?: string | null;
  blurb?: string | null;
  blurbEn?: string | null;
  city?: string | null;
  categorySlug?: string | null;
  heroImageUrl?: string | null;
  foundingYear?: number | null;
  reputationSummary?: ReputationSummary | null;
  siteContent?: unknown | null;
  subcategories?: string[];
  subcategoriesEn?: string[];
  purchaseWebsite?: string | null;
  purchasePinkoi?: string | null;
  purchaseShopee?: string | null;
  purchaseMyship?: string | null;
  socialInstagram?: string | null;
  socialThreads?: string | null;
  socialFacebook?: string | null;
  otherUrls?: OtherUrl[];
};

export function toPublicBrandCard(brand: Brand): PublicBrandCard {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    romanizedName: brand.romanizedName ?? null,
    description: brand.description,
    descriptionEn: brand.descriptionEn,
    blurb: brand.blurb,
    blurbEn: brand.blurbEn,
    heroImageUrl: brand.heroImageUrl,
    logoUrl: brand.logoUrl,
    status: brand.status,
    categorySlug: brand.categorySlug ?? null,
    categoryLabel: brand.categoryLabel,
    subcategories: [...brand.subcategories],
    subcategoriesEn: [...brand.subcategoriesEn],
    foundingYear: brand.foundingYear,
    productPhotos: [...brand.productPhotos],
    imageAlts: brand.imageAlts.map((alt) => ({
      isLogo: alt.isLogo,
      altZh: alt.altZh,
    })),
    heroImageMetadata: brand.heroImageMetadata ?? null,
  };
}

export function toPublicBrandFaqContext(brand: Brand): PublicBrandFaqContext {
  return {
    name: brand.name,
    categoryLabel: brand.categoryLabel,
    city: brand.city,
    categorySlug: brand.categorySlug ?? null,
    subcategories: Array.isArray(brand.subcategories)
      ? [...brand.subcategories]
      : [],
    subcategoriesEn: Array.isArray(brand.subcategoriesEn)
      ? [...brand.subcategoriesEn]
      : [],
    foundingYear: brand.foundingYear,
    reputationSummary: brand.reputationSummary ?? null,
  };
}

/**
 * Normalizes legacy callers that still hold a domain Brand before crossing a
 * public card boundary. Public service paths already return the contract and
 * avoid this branch entirely.
 */
export function normalizePublicBrandCard(
  brand: Brand | PublicBrandCard,
): PublicBrandCard {
  if ("contactEmail" in brand || "isDemo" in brand || "createdAt" in brand) {
    return toPublicBrandCard(brand as Brand);
  }
  return {
    ...brand,
    categorySlug: brand.categorySlug ?? null,
    subcategories: Array.isArray(brand.subcategories)
      ? [...brand.subcategories]
      : [],
    subcategoriesEn: Array.isArray(brand.subcategoriesEn)
      ? [...brand.subcategoriesEn]
      : [],
    productPhotos: Array.isArray(brand.productPhotos)
      ? [...brand.productPhotos]
      : [],
    imageAlts: Array.isArray(brand.imageAlts)
      ? brand.imageAlts.map((alt) => ({
          isLogo: alt.isLogo,
          altZh: alt.altZh,
        }))
      : [],
    heroImageMetadata: brand.heroImageMetadata ?? null,
  };
}

export function toPublicBrandDetail(brand: Brand): PublicBrandDetail {
  return {
    ...toPublicBrandCard(brand),
    city: brand.city,
    socialInstagram: brand.socialInstagram,
    socialThreads: brand.socialThreads,
    socialFacebook: brand.socialFacebook,
    purchaseWebsite: brand.purchaseWebsite,
    purchasePinkoi: brand.purchasePinkoi,
    purchaseShopee: brand.purchaseShopee,
    purchaseMyship: brand.purchaseMyship,
    otherUrls: brand.otherUrls.map((link) => ({
      label: link.label,
      url: link.url,
    })),
    /*
     * The detail projection carries image provenance; the card projection above
     * deliberately does not.
     *
     * `isOwnerSupplied` exists to render the brand-supplied credit, and D11
     * puts that
     * credit on brand detail and nowhere else — beside the image it credits.
     * A directory page ships 24 cards, so carrying a field no card can render
     * would put provenance on every list payload to serve one page that already
     * has it.
     */
    imageAlts: brand.imageAlts.map((alt) => ({
      isLogo: alt.isLogo,
      isOwnerSupplied: alt.isOwnerSupplied ?? false,
      altZh: alt.altZh,
    })),
    heroImageMetadata: brand.heroImageMetadata ?? null,
  };
}

export function toAdminBrandListItem(brand: Brand): AdminBrandListItem {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    status: brand.status,
    isDemo: brand.isDemo,
    categoryLabel: brand.categoryLabel,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
    description: brand.description,
    descriptionEn: brand.descriptionEn,
    blurb: brand.blurb,
    blurbEn: brand.blurbEn,
    city: brand.city,
    categorySlug: brand.categorySlug ?? null,
    heroImageUrl: brand.heroImageUrl,
    foundingYear: brand.foundingYear,
    reputationSummary: brand.reputationSummary ?? null,
    siteContent: brand.siteContent ?? null,
    subcategories: [...brand.subcategories],
    subcategoriesEn: [...brand.subcategoriesEn],
    purchaseWebsite: brand.purchaseWebsite,
    purchasePinkoi: brand.purchasePinkoi,
    purchaseShopee: brand.purchaseShopee,
    purchaseMyship: brand.purchaseMyship,
    socialInstagram: brand.socialInstagram,
    socialThreads: brand.socialThreads,
    socialFacebook: brand.socialFacebook,
    otherUrls: brand.otherUrls.map((link) => ({
      label: link.label,
      url: link.url,
    })),
  };
}
