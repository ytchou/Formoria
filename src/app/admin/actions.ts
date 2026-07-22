'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAction } from '@/lib/auth/require-admin'
import {
  getSubmission,
  getApprovedOwnerSubmissionRecipients,
  approveSubmission,
  applyBrandRefresh,
  rejectSubmission,
  requestBrandRefresh,
  isGeneratedGuestSubmissionEmail,
} from '@/lib/services/submissions'
import { getOwnerLocale } from '@/lib/services/profiles'
import {
  approveClaimRequest,
  getClaimRequest,
  rejectClaimRequest,
} from '@/lib/services/claim-requests'
import { processClaimProofCleanup } from '@/lib/services/claim-proof-cleanup'
import { verifyMitByCert } from '@/lib/services/mit-verification'
import {
  deleteBrand,
  getBrandById,
  syncBrandImages,
  updateBrand,
} from '@/lib/services/brands'
import {
  getUserBrandByEmail,
  revokeOwnership,
} from '@/lib/services/brand-owners'
import {
  scanContent,
  saveModerationFlags,
  markFlagsReviewed,
  updateModerationFlagStatus,
} from '@/lib/services/moderation'
import { sendEmail } from '@/lib/email/send'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
  buildOwnershipRevokedEmail,
} from '@/lib/email/templates'
import { createEmailPreferences } from '@/lib/services/email-lifecycle'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateReportStatus } from '@/lib/services/reports'
import { FEATURE_FLAGS, setAppSetting } from '@/lib/services/app-settings'
import { DENIAL_REASONS, type DenialReason, type OtherUrl } from '@/lib/types'
import { getSiteUrl } from '@/lib/site-url'
import { revalidatePublicBrand } from '@/lib/cache/public-brand-cache'

const MODERATION_FLAG_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function resendClaimInviteAction(
  brandId: string
): Promise<{ resent: true } | { error: string }> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const brand = await getBrandById(brandId)
    if (brand.status !== 'approved') {
      return { error: 'Claim invitations can only be resent for approved brands' }
    }
    if (brand.isVerified) {
      return { error: 'This brand already has an owner' }
    }

    const recipients = await getApprovedOwnerSubmissionRecipients([brandId])
    const recipient = recipients.get(brandId)
    if (!recipient) {
      return { error: 'No approved owner submission was found for this brand' }
    }

    const siteUrl = getSiteUrl()
    const token = await generateClaimToken(brandId, recipient.submitterEmail, brand.name)
    const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
    const delivery = await sendEmail(await buildClaimEmail({
      submitterEmail: recipient.submitterEmail,
      brandName: brand.name,
      claimUrl,
      siteUrl,
    }))
    if (!delivery.success) {
      throw new Error(delivery.error ?? 'Claim invitation could not be sent')
    }

    revalidatePath('/admin/brands')
    return { resent: true }
  } catch (err) {
    console.error('[admin:resendClaimInvite]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
export async function approveSubmissionAction(
  submissionId: string
): Promise<
  | {
      error?: string
      imageSyncWarning?: { synced: number; failed: number }
      storageCleanupWarning?: true
    }
  | undefined
> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const submission = await getSubmission(submissionId)
    if (submission.intent === 'refresh') {
      const refresh = await applyBrandRefresh(submissionId, auth.user.id)
      const brand = await getBrandById(refresh.brandId)
      revalidatePath('/admin/submissions')
      revalidatePath('/admin/brands')
      revalidatePath('/admin')
      revalidatePublicBrand({ slug: brand.slug })
      return refresh.cleanupFailed ? { storageCleanupWarning: true } : undefined
    }

    const siteUrl = getSiteUrl()

    const { brandId, submitterEmail, brandName, isBrandOwner } = await approveSubmission(submissionId, auth.user.id)
    const brand = await getBrandById(brandId)
    let imageSyncWarning: { synced: number; failed: number } | undefined

    try {
      await markFlagsReviewed(brandId)
    } catch (err) {
      console.error('[admin] markFlagsReviewed failed:', err)
    }

    if (brand.heroImageUrl) {
      try {
        const syncResult = await syncBrandImages(brandId)
        if (syncResult.failed > 0) imageSyncWarning = syncResult
      } catch (err) {
        console.error('[admin] syncBrandImages failed:', err)
        imageSyncWarning = { synced: 0, failed: 1 }
      }
    }


    const existingOwnedBrand = isBrandOwner
      ? await getUserBrandByEmail(submitterEmail)
      : null

    const shouldEmailSubmitter = !isGeneratedGuestSubmissionEmail(submitterEmail)

    if (isBrandOwner && !existingOwnedBrand) {
      const token = await generateClaimToken(brandId, submitterEmail, brandName)
      const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
      await sendEmail(await buildClaimEmail({
        submitterEmail,
        brandName,
        claimUrl,
        siteUrl,
      }))
    } else if (shouldEmailSubmitter) {
      await sendEmail(await buildApprovalEmail({
        submitterEmail,
        brandName,
        brandSlug: brand.slug,
        siteUrl,
      }))
    }

    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
    revalidatePublicBrand({ slug: brand.slug })
    if (imageSyncWarning) return { imageSyncWarning }
    return undefined
  } catch (err) {
    console.error('[admin:approveSubmission]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function requestBrandRefreshAction(
  brandId: string
): Promise<{ submissionId: string } | { error: string }> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(brandId)
    ) {
      return { error: 'Invalid brand ID' }
    }
    if (!auth.user.email) return { error: 'Admin email is required' }

    const result = await requestBrandRefresh(brandId, {
      id: auth.user.id,
      email: auth.user.email,
    })
    revalidatePath('/admin/brands')
    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
    return result
  } catch (err) {
    console.error('[admin:requestBrandRefresh]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function rejectSubmissionAction(
  submissionId: string,
  denialReason: DenialReason,
  notes: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    if (!DENIAL_REASONS.includes(denialReason)) {
      return { error: 'Invalid denial reason' }
    }

    if (denialReason === 'other' && notes.trim().length === 0) {
      return { error: 'Notes are required when using "Other" reason' }
    }

    const submission = await getSubmission(submissionId)
    await rejectSubmission(submissionId, auth.user.id, denialReason, notes)

    if (
      submission.intent !== 'refresh' &&
      !isGeneratedGuestSubmissionEmail(submission.submitterEmail)
    ) {
      await sendEmail(await buildRejectionEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        denialReason,
        reviewerNotes: notes,
      }))
    }

    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:rejectSubmission]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

const CLAIM_PROOF_CLEANUP_WARNING = 'Proof deletion remains queued for automatic retry.'

type ClaimDecisionActionResult =
  | { error?: string; warning?: string }
  | undefined

async function processImmediateClaimProofCleanup(
  claimRequestId: string
): Promise<string | undefined> {
  try {
    const summary = await processClaimProofCleanup({ claimRequestId })
    return summary.failed > 0 ? CLAIM_PROOF_CLEANUP_WARNING : undefined
  } catch (err) {
    console.error('[admin:claim-proof-cleanup] process failed', err)
    return CLAIM_PROOF_CLEANUP_WARNING
  }
}

export async function approveClaimAction(
  claimRequestId: string
): Promise<ClaimDecisionActionResult> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = getSiteUrl()
    await approveClaimRequest(claimRequestId, auth.user.id)
    const cleanupWarning = await processImmediateClaimProofCleanup(claimRequestId)

    try {
      const serviceSupabase = createServiceClient()
      await createEmailPreferences(serviceSupabase, claimRequest.userId)
    } catch (err) {
      console.error('[claim-approved-email-preferences] create failed', err)
    }

    if (claimRequest.mitSmileCert) {
      try {
        const mitResult = await verifyMitByCert(claimRequest.brandId, claimRequest.mitSmileCert)
        if (mitResult.error) {
          console.warn('[admin:approveClaimAction] MIT auto-verify skipped:', mitResult.error)
        }
      } catch (err) {
        console.warn('[admin:approveClaimAction] MIT auto-verify error:', err)
      }
    }

    revalidatePath('/admin/claims')
    revalidatePath('/admin')

    if (claimRequest.brandSlug) {
      revalidatePublicBrand({ slug: claimRequest.brandSlug })
    }

    try {
      if (claimRequest.requesterEmail && claimRequest.brandName && claimRequest.brandSlug) {
        const locale = await getOwnerLocale(claimRequest.brandId)
        await sendEmail(await buildClaimApprovedEmail({
          ownerEmail: claimRequest.requesterEmail,
          brandName: claimRequest.brandName,
          brandSlug: claimRequest.brandSlug,
          siteUrl,
          locale,
        }))
      }
    } catch (err) {
      console.error('[claim-approved-email] send failed', err)
    }

    return cleanupWarning ? { warning: cleanupWarning } : undefined
  } catch (err) {
    console.error('[admin:approveClaimAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function rejectClaimAction(
  claimRequestId: string,
  notes: string
): Promise<ClaimDecisionActionResult> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = getSiteUrl()
    await rejectClaimRequest(claimRequestId, auth.user.id, notes)
    const cleanupWarning = await processImmediateClaimProofCleanup(claimRequestId)

    revalidatePath('/admin/claims')
    revalidatePath('/admin')

    try {
      if (claimRequest.requesterEmail && claimRequest.brandName) {
        await sendEmail(await buildClaimRejectedEmail({
          ownerEmail: claimRequest.requesterEmail,
          brandName: claimRequest.brandName,
          reviewerNotes: notes,
          siteUrl,
        }))
      }
    } catch (err) {
      console.error('[claim-rejected-email] send failed', err)
    }

    return cleanupWarning ? { warning: cleanupWarning } : undefined
  } catch (err) {
    console.error('[admin:rejectClaimAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function updateBrandAction(
  brandId: string,
  data: {
    name?: string
    description?: string
    category?: string
    status?: string
    website?: string
    purchaseUrl?: string
    productType?: string
    socialInstagram?: string | null
    socialThreads?: string | null
    socialFacebook?: string | null
    purchaseWebsite?: string | null
    purchasePinkoi?: string | null
    purchaseShopee?: string | null
    otherUrls?: OtherUrl[]
  }
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const previousBrand = await getBrandById(brandId)
    const updatedBrand = await updateBrand(
      brandId,
      data as Parameters<typeof updateBrand>[1],
    )

    const {
      name,
      description,
      website,
      purchaseUrl,
      socialInstagram,
      socialThreads,
      socialFacebook,
      purchaseWebsite,
      purchasePinkoi,
      purchaseShopee,
    } = data
    const moderationFields = {
      name,
      description,
      website,
      purchaseUrl,
      socialInstagram: socialInstagram ?? undefined,
      socialThreads: socialThreads ?? undefined,
      socialFacebook: socialFacebook ?? undefined,
      purchaseWebsite: purchaseWebsite ?? undefined,
      purchasePinkoi: purchasePinkoi ?? undefined,
      purchaseShopee: purchaseShopee ?? undefined,
    }
    const { violations } = scanContent(name ?? '', moderationFields)
    if (violations.length > 0) {
      try {
        await saveModerationFlags(brandId, auth.user.id, violations)
        await markFlagsReviewed(brandId)
      } catch (err) {
        console.error('[admin] moderation audit failed:', err)
      }
    }

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePublicBrand({
      slug: updatedBrand.slug,
      previousSlug: previousBrand.slug,
    })
    return undefined
  } catch (err) {
    console.error('[admin:updateBrand]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function hideBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const brand = await updateBrand(brandId, { status: 'hidden' })

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePublicBrand({ slug: brand.slug })
    return undefined
  } catch (err) {
    console.error('[admin:hideBrand]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function unhideBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const brand = await updateBrand(brandId, { status: 'approved' })

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePublicBrand({ slug: brand.slug })
    return undefined
  } catch (err) {
    console.error('[admin:unhideBrand]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function deleteBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const brand = await getBrandById(brandId)
    await deleteBrand(brandId)

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePublicBrand({ slug: brand.slug })
    return undefined
  } catch (err) {
    console.error('[admin:deleteBrand]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function reviewReportAction(
  reportId: string,
  decision: 'reviewed' | 'dismissed'
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    await updateReportStatus(reportId, decision)

    revalidatePath('/admin/reports')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:reviewReport]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function reviewModerationFlagAction(
  flagId: string,
  decision: 'reviewed' | 'dismissed',
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    if (!MODERATION_FLAG_ID_REGEX.test(flagId)) {
      return { error: 'Invalid moderation flag ID' }
    }
    if (decision !== 'reviewed' && decision !== 'dismissed') {
      return { error: 'Invalid moderation decision' }
    }

    await updateModerationFlagStatus(flagId, decision)

    revalidatePath('/admin/moderation')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:reviewModerationFlag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function reviewModerationFlagFormAction(
  flagId: string,
  decision: 'reviewed' | 'dismissed',
): Promise<void> {
  const result = await reviewModerationFlagAction(flagId, decision)
  if (result?.error) throw new Error(result.error)
}

export async function revokeOwnershipAction(
  brandId: string,
  reason: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const trimmedReason = reason.trim()
    if (!trimmedReason) return { error: 'Reason is required' }
    if (!auth.user.email) return { error: 'Admin email is required' }

    const result = await revokeOwnership(brandId, auth.user.email, trimmedReason)
    const brand = await getBrandById(brandId)

    await sendEmail(await buildOwnershipRevokedEmail({
      ownerEmail: result.email,
      brandName: brand.name,
      reason: trimmedReason,
    }))

    revalidatePath('/admin/reports')
    revalidatePath('/admin')
    revalidatePublicBrand({ slug: brand.slug })
    return undefined
  } catch (err) {
    console.error('[admin:revokeOwnership]', err)
    if (
      typeof err === 'object'
      && err !== null
      && 'message' in err
      && err.message === 'Brand owner not found'
    ) {
      return { error: 'Brand owner not found' }
    }
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function setFeatureFlagAction(
  key: string,
  enabled: boolean
): Promise<{
  error?: string
  code?: 'unauthenticated' | 'forbidden'
}> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const flag = FEATURE_FLAGS.find((entry) => entry.key === key)
    if (!flag) {
      return { error: 'Unknown feature flag' }
    }

    await setAppSetting(key, enabled)
    flag.revalidatePaths.forEach((path) => revalidatePath(path))
    return {}
  } catch (err) {
    console.error('[admin:setFeatureFlag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
