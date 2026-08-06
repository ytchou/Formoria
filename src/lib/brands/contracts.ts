import type {
  Brand,
  OtherUrl,
  ReputationSummary,
  SiteContent,
  SiteProduct,
  SiteTokens,
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
  productType?: string | null
  category: string | null
  isVerified: boolean
  mitStatus?: 'unverified' | 'declared' | 'verified'
  priceRange: number | null
  productTags: string[]
  productTagsEn: string[]
  foundingYear: number | null
  productPhotos: string[]
  imageAlts: Array<{ altZh: string | null; altEn: string | null }>
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
    imageAlts: Array<{ altZh: string | null; altEn: string | null }>
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
  foundingYear: number | null
  mitVerified: boolean
  siteContent: PublicSiteContent
}

export type SearchSuggestion = {
  id: string
  slug: string
  name: string
  category: string
}

/**
 * Evidence available to render the public FAQ floors. This is intentionally
 * separate from both the public detail contract and the internal Brand row:
 * the detail route fetches it with its own projection and never serializes it.
 */
export type PublicBrandFaqContext = {
  name: string
  category: string | null
  city: string | null
  productType?: string | null
  productTags: string[]
  productTagsEn: string[]
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
  imageAlts: Array<{ altZh: string | null; altEn: string | null }>
}

export type AdminBrandListItem = {
  id: string
  name: string
  slug: string
  status: 'approved' | 'hidden'
  isDemo: boolean
  category: string | null
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
  productType?: string | null
  heroImageUrl?: string | null
  foundingYear?: number | null
  reputationSummary?: ReputationSummary | null
  mitEvidence?: Brand['mitEvidence']
  siteContent?: SiteContent | null
  priceRange?: number | null
  productTags?: string[]
  productTagsEn?: string[]
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
    productType: brand.productType ?? null,
    category: brand.category,
    isVerified: brand.isVerified,
    mitStatus: brand.mitStatus ?? 'unverified',
    priceRange: brand.priceRange,
    productTags: [...brand.productTags],
    productTagsEn: [...brand.productTagsEn],
    foundingYear: brand.foundingYear,
    productPhotos: [...brand.productPhotos],
    imageAlts: brand.imageAlts.map((alt) => ({ altZh: alt.altZh, altEn: alt.altEn })),
    heroImageMetadata: brand.heroImageMetadata ?? null,
  }
}

export function toPublicBrandFaqContext(brand: Brand): PublicBrandFaqContext {
  return {
    name: brand.name,
    category: brand.category,
    city: brand.city,
    productType: brand.productType ?? null,
    productTags: Array.isArray(brand.productTags) ? [...brand.productTags] : [],
    productTagsEn: Array.isArray(brand.productTagsEn) ? [...brand.productTagsEn] : [],
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
    productType: brand.productType ?? null,
    mitStatus: brand.mitStatus ?? 'unverified',
    productTags: Array.isArray(brand.productTags) ? [...brand.productTags] : [],
    productTagsEn: Array.isArray(brand.productTagsEn) ? [...brand.productTagsEn] : [],
    productPhotos: Array.isArray(brand.productPhotos) ? [...brand.productPhotos] : [],
    imageAlts: Array.isArray(brand.imageAlts) ? [...brand.imageAlts] : [],
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
    imageAlts: brand.imageAlts.map((alt) => ({ altZh: alt.altZh, altEn: alt.altEn })),
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
    category: brand.category,
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
    productType: brand.productType ?? null,
    heroImageUrl: brand.heroImageUrl,
    foundingYear: brand.foundingYear,
    reputationSummary: brand.reputationSummary ?? null,
    mitEvidence: brand.mitEvidence ?? null,
    siteContent: brand.siteContent ?? null,
    priceRange: brand.priceRange,
    productTags: [...brand.productTags],
    productTagsEn: [...brand.productTagsEn],
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
