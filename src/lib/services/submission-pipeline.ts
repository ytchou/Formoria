import type { Brand } from '@/lib/types'
import type { SourceAttribution } from '@/lib/types/submission'
import { createBrand, generateSlug } from '@/lib/services/brands'
import { createSubmission } from '@/lib/services/submissions'
import { classifySubmittedUrl } from '@/lib/services/link-enrichment'

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
  let socialInstagram = params.socialLinks?.instagram || null
  let socialThreads = params.socialLinks?.threads || null
  let socialFacebook = params.socialLinks?.facebook || null

  // Map purchase links: known platforms get dedicated columns; others go to otherUrls
  const purchaseLinks = params.purchaseLinks ?? []
  let purchasePinkoi =
    purchaseLinks.find((l) => l.platform === 'pinkoi')?.url ?? null
  let purchaseShopee =
    purchaseLinks.find((l) => l.platform === 'shopee')?.url ?? null
  const otherPurchaseUrls = purchaseLinks
    .filter((l) => l.platform !== 'pinkoi' && l.platform !== 'shopee')
    .map((l) => ({ label: l.platform, url: l.url }))

  let purchaseWebsite: string | null = null

  if (params.website) {
    const classified = classifySubmittedUrl(params.website)
    if (classified.socialInstagram && !socialInstagram) socialInstagram = classified.socialInstagram
    if (classified.socialThreads && !socialThreads) socialThreads = classified.socialThreads
    if (classified.socialFacebook && !socialFacebook) socialFacebook = classified.socialFacebook
    if (classified.purchasePinkoi && !purchasePinkoi) purchasePinkoi = classified.purchasePinkoi
    if (classified.purchaseShopee && !purchaseShopee) purchaseShopee = classified.purchaseShopee
    if (classified.purchaseWebsite) purchaseWebsite = classified.purchaseWebsite
  }

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
    purchaseWebsite,
    purchasePinkoi,
    purchaseShopee,
    otherUrls: otherPurchaseUrls,
    retailLocations,
    productPhotos: [],
    contactEmail: params.submitterEmail,
    brandHighlights: null,
    siteContent: null,
    unifiedBusinessNumber,
    productType: undefined,
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
    purchaseWebsite,
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
