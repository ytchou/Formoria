import type {
  Brand,
  BrandImageMeta,
  OtherUrl,
  ReputationSummary,
  SiteContent,
  SiteProduct,
} from '@/lib/types/brand'

/** Purchase links are intentionally spelled out at every public boundary. */
type PublicPurchaseLinks = {
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  purchaseMyship: string | null
}

export type PublicBrandCard = {
  id: string
  name: string
  slug: string
  romanizedName?: string | null
  description: string | null
  descriptionEn: string | null
  blurb: string | null
  blurbEn: string | null
  heroImageUrl: string | null
  status: 'approved' | 'hidden'
  categorySlug?: string | null
  categoryLabel: string | null
  isVerified: boolean
  mitStatus?: 'unverified' | 'declared' | 'verified'
  priceRange: number | null
  subcategories: string[]
  subcategoriesEn: string[]
  foundingYear: number | null
  productPhotos: string[]
  imageAlts: BrandImageMeta[]
  heroImageMetadata: Brand['heroImageMetadata']
}

export type PublicBrandDetail = PublicBrandCard &
  PublicPurchaseLinks & {
    city: string | null
    socialInstagram: string | null
    socialThreads: string | null
    socialFacebook: string | null
    otherUrls: OtherUrl[]
    mitStory: string | null
    /** The certificate number is public; the evidence object is not. */
    mitCertificateNumber: string | null
    imageAlts: BrandImageMeta[]
    heroImageMetadata: Brand['heroImageMetadata']
  }

type PublicSiteTokens = {
  accent: string
  accentForeground?: string
}

export type PublicSiteProduct = {
  name: string
  imageUrl?: string
  url?: string
  caption?: string
}

type PublicSiteContent = {
  template: string
  tokens: PublicSiteTokens
  tagline?: string
  story?: string
  products: PublicSiteProduct[]
  ctaType: 'mailto'
  /** Only an explicitly configured CTA may produce a public email link. */
  ctaValue?: string
}

export type PublicMicrositeBrand = {
  id: string
  name: string
  slug: string
  status: 'approved' | 'hidden'
  description: string | null
  heroImageUrl: string | null
  /**
   * Metadata for the hero image ONLY — this surface renders exactly one image,
   * so a full index-aligned `imageAlts` array would be dishonest about what is
   * carried. Nullable because a brand's hero can predate `brand_images`.
   *
   * Deliberately a whole `BrandImageMeta` rather than the flattened
   * `isLogo`/`focalX`/`focalY` triple it replaces: the flattened names only
   * satisfied `objectPositionStyle` by coinciding with its structural
   * parameter, so nothing tied them to `BrandImageMeta` and a field added there
   * would never have reached this contract.
   */
  heroImageMeta: BrandImageMeta | null
  foundingYear: number | null
  mitVerified: boolean
  siteContent: PublicSiteContent
}

export type SearchSuggestion = {
  id: string
  slug: string
  name: string
  categoryLabel: string
}

/**
 * Evidence available to render the public FAQ floors. This is intentionally
 * separate from both the public detail contract and the internal Brand row:
 * the detail route fetches it with its own projection and never serializes it.
 */
export type PublicBrandFaqContext = {
  name: string
  categoryLabel: string | null
  city: string | null
  categorySlug?: string | null
  subcategories: string[]
  subcategoriesEn: string[]
  priceRange: number | null
  foundingYear: number | null
  reputationSummary?: ReputationSummary | null
  mitStatus?: 'unverified' | 'declared' | 'verified'
  mitDeclaredScope?: 'all' | 'most' | 'some' | null
  mitStory?: string | null
}

export type OwnerBrandEditor = PublicBrandDetail & {
  romanizedName: string | null
  reputationSummary: ReputationSummary | null
  mitEvidence: NonNullable<Brand['mitEvidence']> | null
  siteContent: SiteContent | null
  imageAlts: BrandImageMeta[]
}

export type AdminBrandListItem = {
  id: string
  name: string
  slug: string
  status: 'approved' | 'hidden'
  isDemo: boolean
  categoryLabel: string | null
  createdAt: string
  updatedAt: string
  mitStatus?: 'unverified' | 'declared' | 'verified'
  mitCertificateNumber?: string | null
  mitVerified?: boolean
  isVerified?: boolean
  description?: string | null
  descriptionEn?: string | null
  blurb?: string | null
  blurbEn?: string | null
  city?: string | null
  categorySlug?: string | null
  heroImageUrl?: string | null
  foundingYear?: number | null
  reputationSummary?: ReputationSummary | null
  mitEvidence?: Brand['mitEvidence']
  siteContent?: SiteContent | null
  priceRange?: number | null
  subcategories?: string[]
  subcategoriesEn?: string[]
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
  purchaseMyship?: string | null
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  otherUrls?: OtherUrl[]
}

function publicSiteContent(siteContent: SiteContent | null): PublicSiteContent | null {
  if (!siteContent) return null
  return {
    template: siteContent.template,
    tokens: {
      accent: siteContent.tokens.accent,
      ...(siteContent.tokens.accentForeground
        ? { accentForeground: siteContent.tokens.accentForeground }
        : {}),
    },
    ...(siteContent.tagline !== undefined ? { tagline: siteContent.tagline } : {}),
    ...(siteContent.story !== undefined ? { story: siteContent.story } : {}),
    products: siteContent.products.map((product: SiteProduct) => ({
      name: product.name,
      ...(product.imageUrl !== undefined ? { imageUrl: product.imageUrl } : {}),
      ...(product.url !== undefined ? { url: product.url } : {}),
      ...(product.caption !== undefined ? { caption: product.caption } : {}),
    })),
    ctaType: siteContent.ctaType,
    ...(siteContent.ctaValue !== undefined ? { ctaValue: siteContent.ctaValue } : {}),
  }
}

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
    status: brand.status,
    categorySlug: brand.categorySlug ?? null,
    categoryLabel: brand.categoryLabel,
    isVerified: brand.isVerified,
    mitStatus: brand.mitStatus ?? 'unverified',
    priceRange: brand.priceRange,
    subcategories: [...brand.subcategories],
    subcategoriesEn: [...brand.subcategoriesEn],
    foundingYear: brand.foundingYear,
    productPhotos: [...brand.productPhotos],
    imageAlts: brand.imageAlts.map((alt) => ({
      altZh: alt.altZh,
      altEn: alt.altEn,
      isLogo: alt.isLogo,
      focalX: alt.focalX,
      focalY: alt.focalY,
    })),
    heroImageMetadata: brand.heroImageMetadata ?? null,
  }
}

export function toPublicBrandFaqContext(brand: Brand): PublicBrandFaqContext {
  return {
    name: brand.name,
    categoryLabel: brand.categoryLabel,
    city: brand.city,
    categorySlug: brand.categorySlug ?? null,
    subcategories: Array.isArray(brand.subcategories) ? [...brand.subcategories] : [],
    subcategoriesEn: Array.isArray(brand.subcategoriesEn) ? [...brand.subcategoriesEn] : [],
    priceRange: brand.priceRange,
    foundingYear: brand.foundingYear,
    reputationSummary: brand.reputationSummary ?? null,
    mitStatus: brand.mitStatus ?? 'unverified',
    mitDeclaredScope: brand.mitDeclaredScope ?? null,
    mitStory: brand.mitStory ?? null,
  }
}

/**
 * Normalizes legacy callers that still hold a domain Brand before crossing a
 * public card boundary. Public service paths already return the contract and
 * avoid this branch entirely.
 */
export function normalizePublicBrandCard(
  brand: Brand | PublicBrandCard,
): PublicBrandCard {
  if ('contactEmail' in brand || 'isDemo' in brand || 'createdAt' in brand) {
    return toPublicBrandCard(brand as Brand)
  }
  return {
    ...brand,
    categorySlug: brand.categorySlug ?? null,
    mitStatus: brand.mitStatus ?? 'unverified',
    subcategories: Array.isArray(brand.subcategories) ? [...brand.subcategories] : [],
    subcategoriesEn: Array.isArray(brand.subcategoriesEn) ? [...brand.subcategoriesEn] : [],
    productPhotos: Array.isArray(brand.productPhotos) ? [...brand.productPhotos] : [],
    imageAlts: Array.isArray(brand.imageAlts)
      ? brand.imageAlts.map((alt) => ({
          altZh: alt.altZh,
          altEn: alt.altEn,
          isLogo: alt.isLogo,
          focalX: alt.focalX,
          focalY: alt.focalY,
        }))
      : [],
    heroImageMetadata: brand.heroImageMetadata ?? null,
  }
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
    otherUrls: brand.otherUrls.map((link) => ({ label: link.label, url: link.url })),
    mitStory: brand.mitStory ?? null,
    mitCertificateNumber: brand.mitEvidence?.mit_smile_cert ?? null,
    imageAlts: brand.imageAlts.map((alt) => ({
      altZh: alt.altZh,
      altEn: alt.altEn,
      isLogo: alt.isLogo,
      focalX: alt.focalX,
      focalY: alt.focalY,
    })),
    heroImageMetadata: brand.heroImageMetadata ?? null,
  }
}

export function toPublicMicrositeBrand(brand: Brand): PublicMicrositeBrand | null {
  const content = publicSiteContent(brand.siteContent)
  if (!content) return null
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    status: brand.status,
    heroImageUrl: brand.heroImageUrl,
    heroImageMeta: brand.imageAlts.at(0) ?? null,
    description: brand.description,
    foundingYear: brand.foundingYear,
    mitVerified: brand.mitStatus === 'verified' || brand.mitVerified === true,
    siteContent: content,
  }
}

export function toOwnerBrandEditor(brand: Brand): OwnerBrandEditor {
  return {
    ...toPublicBrandDetail(brand),
    romanizedName: brand.romanizedName ?? null,
    reputationSummary: brand.reputationSummary ?? null,
    mitEvidence: brand.mitEvidence ?? null,
    siteContent: brand.siteContent ?? null,
  }
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
    mitStatus: brand.mitStatus ?? (brand.mitVerified ? 'verified' : 'unverified'),
    mitCertificateNumber: brand.mitEvidence?.mit_smile_cert ?? null,
    mitVerified: brand.mitVerified ?? false,
    isVerified: brand.isVerified,
    description: brand.description,
    descriptionEn: brand.descriptionEn,
    blurb: brand.blurb,
    blurbEn: brand.blurbEn,
    city: brand.city,
    categorySlug: brand.categorySlug ?? null,
    heroImageUrl: brand.heroImageUrl,
    foundingYear: brand.foundingYear,
    reputationSummary: brand.reputationSummary ?? null,
    mitEvidence: brand.mitEvidence ?? null,
    siteContent: brand.siteContent ?? null,
    priceRange: brand.priceRange,
    subcategories: [...brand.subcategories],
    subcategoriesEn: [...brand.subcategoriesEn],
    purchaseWebsite: brand.purchaseWebsite,
    purchasePinkoi: brand.purchasePinkoi,
    purchaseShopee: brand.purchaseShopee,
    purchaseMyship: brand.purchaseMyship,
    socialInstagram: brand.socialInstagram,
    socialThreads: brand.socialThreads,
    socialFacebook: brand.socialFacebook,
    otherUrls: brand.otherUrls.map((link) => ({ label: link.label, url: link.url })),
  }
}
