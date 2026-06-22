import type { Brand } from '@/lib/types'
import type { SourceAttribution } from '@/lib/types/submission'
import { createBrand, generateSlug } from '@/lib/services/brands'
import { createSubmission } from '@/lib/services/submissions'

export interface SubmitBrandForReviewParams {
  name: string
  website?: string
  region: string
  isOwner?: boolean
  pdpaConsent?: boolean
  sourceAttribution?: SourceAttribution | null
  ubn?: string | null
  retailLocations?: Array<{ name: string; address: string; latitude?: number; longitude?: number }>
  submitterEmail: string
  submitterName?: string
  socialLinks?: {
    instagram?: string
    threads?: string
    facebook?: string
    website?: string
  } | null
  purchaseLinks?: Array<{ platform: string; url: string }> | null
}

export interface SubmitBrandForReviewResult {
  brand: Brand
  submissionId: string
}

export async function submitBrandForReview(
  params: SubmitBrandForReviewParams
): Promise<SubmitBrandForReviewResult> {
  const retailLocations = (params.retailLocations ?? []).map((location) => ({
    ...location,
    latitude: 0,
    longitude: 0,
  }))
  const unifiedBusinessNumber = params.ubn ?? null

  // Map social links
  const socialInstagram = params.socialLinks?.instagram || null
  const socialThreads = params.socialLinks?.threads || null
  const socialFacebook = params.socialLinks?.facebook || null

  // Map purchase links: known platforms get dedicated columns; others go to otherUrls
  const purchaseLinks = params.purchaseLinks ?? []
  const purchasePinkoi =
    purchaseLinks.find((l) => l.platform === 'pinkoi')?.url ?? null
  const purchaseShopee =
    purchaseLinks.find((l) => l.platform === 'shopee')?.url ?? null
  const otherPurchaseUrls = purchaseLinks
    .filter((l) => l.platform !== 'pinkoi' && l.platform !== 'shopee')
    .map((l) => ({ label: l.platform, url: l.url }))

  const brand = await createBrand({
    name: params.name,
    slug: generateSlug(params.name),
    description: null,
    heroImageUrl: null,
    status: 'pending',
    isVerified: false,
    isDemo: false,
    category: null,
    foundingYear: null,
    socialInstagram,
    socialThreads,
    socialFacebook,
    purchaseWebsite: params.website ?? null,
    purchasePinkoi,
    purchaseShopee,
    otherUrls: otherPurchaseUrls,
    retailLocations,
    productPhotos: [],
    contactEmail: params.submitterEmail,
    brandHighlights: null,
    siteContent: null,
    unifiedBusinessNumber,
    productType: '',
  })

  const submission = await createSubmission({
    brandId: brand.id,
    brandName: params.name,
    submitterEmail: params.submitterEmail,
    submitterName: params.submitterName,
    description: null,
    websiteUrl: params.website,
    socialInstagram,
    socialThreads,
    socialFacebook,
    purchaseWebsite: params.website,
    purchasePinkoi,
    purchaseShopee,
    otherUrls: otherPurchaseUrls,
    suggestedTags: { region: params.region },
    isBrandOwner: params.isOwner ?? false,
    sourceAttribution: params.sourceAttribution ?? null,
    pdpaConsentAt: params.pdpaConsent ? new Date().toISOString() : undefined,
    productTypeNote: null,
    unifiedBusinessNumber: unifiedBusinessNumber ?? undefined,
  })

  return { brand, submissionId: submission.id }
}
