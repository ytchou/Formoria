import type { OtherUrl } from '@/lib/types'
import type { SourceAttribution } from '@/lib/types/submission'
import { createSubmission } from '@/lib/services/submissions'
import { classifySubmittedUrl } from '@/lib/services/link-enrichment'

export interface SubmitBrandForReviewParams {
  brandName: string
  websiteUrl?: string
  region?: string
  isBrandOwner?: boolean
  pdpaConsent?: boolean
  sourceAttribution?: SourceAttribution | null
  ubn?: string | null
  unifiedBusinessNumber?: string | null
  submitterEmail: string
  submitterName?: string
  description?: string | null
  socialLinks?: {
    instagram?: string
    threads?: string
    facebook?: string
    website?: string
  } | null
  purchaseLinks?: Array<{ platform: string; url: string }> | null
  otherUrls?: OtherUrl[] | null
  suggestedTags?: { region?: string; values?: string[]; productType?: string }
  productType?: string | null
  productTypeNote?: string | null
}

export interface SubmitBrandForReviewResult {
  submissionId: string
  brandSlug?: undefined
}

export async function submitBrandForReview(
  params: SubmitBrandForReviewParams
): Promise<SubmitBrandForReviewResult> {
  const unifiedBusinessNumber = params.unifiedBusinessNumber ?? params.ubn ?? null

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

  if (params.websiteUrl) {
    const classified = classifySubmittedUrl(params.websiteUrl)
    if (classified.socialInstagram && !socialInstagram) socialInstagram = classified.socialInstagram
    if (classified.socialThreads && !socialThreads) socialThreads = classified.socialThreads
    if (classified.socialFacebook && !socialFacebook) socialFacebook = classified.socialFacebook
    if (classified.purchasePinkoi && !purchasePinkoi) purchasePinkoi = classified.purchasePinkoi
    if (classified.purchaseShopee && !purchaseShopee) purchaseShopee = classified.purchaseShopee
    if (classified.purchaseWebsite) purchaseWebsite = classified.purchaseWebsite
  }

  const suggestedTags = {
    ...(params.suggestedTags ?? {}),
    ...(params.region ? { region: params.region } : {}),
    ...(params.productType ? { productType: params.productType } : {}),
  }

  const submission = await createSubmission({
    brandId: null,
    brandName: params.brandName,
    submitterEmail: params.submitterEmail,
    submitterName: params.submitterName,
    description: params.description ?? null,
    websiteUrl: params.websiteUrl,
    socialInstagram,
    socialThreads,
    socialFacebook,
    purchaseWebsite,
    purchasePinkoi,
    purchaseShopee,
    otherUrls: [...(params.otherUrls ?? []), ...otherPurchaseUrls],
    suggestedTags,
    isBrandOwner: params.isBrandOwner ?? false,
    sourceAttribution: params.sourceAttribution ?? null,
    pdpaConsentAt: params.pdpaConsent ? new Date().toISOString() : undefined,
    productTypeNote: params.productTypeNote ?? null,
    unifiedBusinessNumber: unifiedBusinessNumber ?? undefined,
  })

  return { submissionId: submission.id }
}
