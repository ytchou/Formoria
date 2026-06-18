import type { Brand } from '@/lib/types'
import type { SourceAttribution } from '@/lib/types/submission'
import type { ModerationFlag } from '@/lib/services/moderation'
import { createBrand } from '@/lib/services/brands'
import { saveModerationFlags } from '@/lib/services/moderation'
import { createSubmission } from '@/lib/services/submissions'

export interface SubmitBrandForReviewParams {
  name: string
  slug: string
  description: string
  logoUrl: string | null
  category: string | null
  purchaseLinks: Array<{ url: string; platform: string; label: string }>
  socialLinks: {
    instagram?: string
    threads?: string
    facebook?: string
    officialWebsite?: string
  }
  retailLocations: Array<{ name: string; address: string; latitude: number; longitude: number }>
  productPhotos: string[]
  contactEmail: string | null
  brandHighlights: string | null
  unifiedBusinessNumber: string | null

  submitterEmail: string
  submitterName: string | null
  isBrandOwner: boolean
  sourceAttribution?: SourceAttribution | null
  pdpaConsentAt: string

  region?: string | null
  valueTags?: string[]
  productType?: string
  productTypeNote?: string | null

  moderationFlags?: ModerationFlag[]
  moderatorUserId: string
  onModerationFlagsError?: (error: unknown) => void
}

export interface SubmitBrandForReviewResult {
  brand: Brand
  submissionId: string
}

function getSubmittedProductType(params: SubmitBrandForReviewParams): string | undefined {
  if (params.productType) {
    return params.productType
  }

  const legacyProductTypes = (params as SubmitBrandForReviewParams & { productTypes?: unknown })
    .productTypes
  if (!Array.isArray(legacyProductTypes)) {
    return undefined
  }

  const productType = legacyProductTypes.find((item): item is string => typeof item === 'string')
  return productType || undefined
}

export async function submitBrandForReview(
  params: SubmitBrandForReviewParams
): Promise<SubmitBrandForReviewResult> {
  const productType = getSubmittedProductType(params)

  const brand = await createBrand({
    name: params.name,
    slug: params.slug,
    description: params.description,
    logoUrl: params.logoUrl,
    heroImageUrl: null,
    status: 'pending',
    isVerified: false,
    isDemo: false,
    category: params.category,
    foundingYear: null,
    purchaseLinks: params.purchaseLinks,
    socialLinks: params.socialLinks,
    retailLocations: params.retailLocations,
    productPhotos: params.productPhotos,
    contactEmail: params.contactEmail,
    brandHighlights: params.brandHighlights,
    siteContent: null,
    unifiedBusinessNumber: params.unifiedBusinessNumber,
    productType,
  })

  if (params.moderationFlags?.length) {
    try {
      await saveModerationFlags(brand.id, params.moderatorUserId, params.moderationFlags)
    } catch (error) {
      if (!params.onModerationFlagsError) {
        throw error
      }
      params.onModerationFlagsError(error)
    }
  }

  const suggestedTags = {
    ...(params.region ? { region: params.region } : {}),
    ...(params.valueTags?.length ? { values: params.valueTags } : {}),
    ...(productType ? { productType } : {}),
  } as unknown as Parameters<typeof createSubmission>[0]['suggestedTags']

  const submission = await createSubmission({
    brandId: brand.id,
    brandName: params.name,
    submitterEmail: params.submitterEmail,
    submitterName: params.submitterName ?? undefined,
    description: params.description,
    websiteUrl: params.socialLinks.officialWebsite ?? null,
    socialLinks: params.socialLinks,
    suggestedTags,
    isBrandOwner: params.isBrandOwner,
    sourceAttribution: params.sourceAttribution ?? null,
    pdpaConsentAt: params.pdpaConsentAt,
    productTypeNote: params.productTypeNote ?? null,
    unifiedBusinessNumber: params.unifiedBusinessNumber ?? undefined,
  })

  return { brand, submissionId: submission.id }
}
