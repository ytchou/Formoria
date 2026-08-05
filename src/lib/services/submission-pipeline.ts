import type { OtherUrl, SubmissionIntent } from '@/lib/types'
import { auditedCall } from '@/lib/audit'
import type { SourceAttribution } from '@/lib/types/submission'
import { createSubmission } from '@/lib/services/submissions'
import { classifySubmittedUrl } from '@/lib/services/link-enrichment'
import {
  PURCHASE_CHANNELS,
  type PurchaseChannelCamelField,
} from '@/lib/brands/purchase-channels'

export interface SubmitBrandForReviewParams {
  intent?: SubmissionIntent
  brandName: string
  romanizedName?: string | null
  websiteUrl?: string
  heroImageUrl?: string
  isBrandOwner?: boolean
  pdpaConsent?: boolean
  sourceAttribution?: SourceAttribution | null
  submitterEmail: string
  submitterName?: string
  description?: string | null
  purchaseWebsite?: string | null
  socialLinks?: {
    instagram?: string
    threads?: string
    facebook?: string
    pinkoi?: string
    shopee?: string
    myship?: string
  } | null
  purchaseLinks?: Array<{ platform: string; url: string }> | null
  otherUrls?: OtherUrl[] | null
  suggestedTags?: { values?: string[]; productType?: string }
  productType?: string | null
  productTypeNote?: string | null
  mitSmileCert?: string
  ownerData?: Record<string, unknown>
}

export interface SubmitBrandForReviewResult {
  submissionId: string
  brandSlug?: undefined
}

export async function submitBrandForReview(
  params: SubmitBrandForReviewParams,
  options?: { useServiceRole?: boolean }
): Promise<SubmitBrandForReviewResult> {
  return auditedCall(
    { provider: 'submissions', operation: 'submitBrandForReview', kind: 'service' },
    async () => {
  // Map social links
  let socialInstagram = params.socialLinks?.instagram || null
  let socialThreads = params.socialLinks?.threads || null
  let socialFacebook = params.socialLinks?.facebook || null

  // Map purchase links: known platforms get dedicated columns; others go to otherUrls.
  // "Known" means a channel that owns a host in the registry — the brand's own
  // website owns none, arrives via `params.purchaseWebsite`, and a purchaseLinks
  // entry naming it has always fallen through to otherUrls. That is preserved.
  const purchaseLinks = params.purchaseLinks ?? []
  const platformChannels = PURCHASE_CHANNELS.filter((channel) => channel.hosts.length > 0)
  const platformSlugs = new Set<string>(platformChannels.map((channel) => channel.platformSlug))
  const submittedSocialLinks = { ...params.socialLinks } as Record<string, string | undefined>

  const purchaseValues = Object.fromEntries(
    PURCHASE_CHANNELS.map(
      (channel): [PurchaseChannelCamelField, string | null] => [channel.camel, null],
    ),
  ) as Record<PurchaseChannelCamelField, string | null>

  for (const channel of platformChannels) {
    purchaseValues[channel.camel] =
      submittedSocialLinks[channel.key] ||
      (purchaseLinks.find((l) => l.platform === channel.platformSlug)?.url ?? null)
  }

  const otherPurchaseUrls = purchaseLinks
    .filter((l) => !platformSlugs.has(l.platform))
    .map((l) => ({ label: l.platform, url: l.url }))

  for (const channel of PURCHASE_CHANNELS) {
    if (channel.hosts.length > 0) continue
    purchaseValues[channel.camel] = params.purchaseWebsite?.trim() || null
  }

  if (params.websiteUrl) {
    const classified = classifySubmittedUrl(params.websiteUrl)
    if (classified.socialInstagram && !socialInstagram) socialInstagram = classified.socialInstagram
    if (classified.socialThreads && !socialThreads) socialThreads = classified.socialThreads
    if (classified.socialFacebook && !socialFacebook) socialFacebook = classified.socialFacebook
    for (const channel of PURCHASE_CHANNELS) {
      const classifiedUrl = classified[channel.camel]
      if (classifiedUrl && !purchaseValues[channel.camel]) {
        purchaseValues[channel.camel] = classifiedUrl
      }
    }
  }

  const suggestedTags = {
    ...(params.suggestedTags ?? {}),
    ...(params.productType ? { productType: params.productType } : {}),
    ...(params.mitSmileCert ? { mitSmileCert: params.mitSmileCert } : {}),
  }

  const submission = await createSubmission({
    brandId: null,
    intent: params.intent ?? 'recommend',
    brandName: params.brandName,
    romanizedName: params.romanizedName,
    submitterEmail: params.submitterEmail,
    submitterName: params.submitterName,
    description: params.description ?? null,
    websiteUrl: params.websiteUrl,
    heroImageUrl: params.heroImageUrl,
    socialInstagram,
    socialThreads,
    socialFacebook,
    ...purchaseValues,
    otherUrls: [...(params.otherUrls ?? []), ...otherPurchaseUrls],
    suggestedTags,
    isBrandOwner: params.isBrandOwner ?? false,
    sourceAttribution: params.sourceAttribution ?? null,
    pdpaConsentAt: params.pdpaConsent ? new Date().toISOString() : undefined,
    productTypeNote: params.productTypeNote ?? null,
    ownerData: params.ownerData,
  }, options)

  return { submissionId: submission.id }
    },
  )
}
