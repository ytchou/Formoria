'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAction } from '@/lib/auth/require-admin'
import {
  getSubmission,
  approveSubmission,
  rejectSubmission,
  isGeneratedGuestSubmissionEmail,
} from '@/lib/services/submissions'
import type { SubmissionApprovalOverrides } from '@/lib/services/submissions'
import { getOwnerLocale } from '@/lib/services/profiles'
import {
  approveClaimRequest,
  getClaimRequest,
  rejectClaimRequest,
} from '@/lib/services/claim-requests'
import {
  approvePendingEdit,
  getPendingEditForReview,
  rejectPendingEdit,
} from '@/lib/services/pending-edits'
import { verifyMitByCert } from '@/lib/services/mit-verification'
import {
  deleteBrand,
  getBrandById,
  syncBrandImages,
  updateBrand,
} from '@/lib/services/brands'
import {
  getBrandOwnerEmail,
  getUserBrandByEmail,
  revokeOwnership,
} from '@/lib/services/brand-owners'
import { scanContent, saveModerationFlags, markFlagsReviewed } from '@/lib/services/moderation'
import { sendEmail } from '@/lib/email/send'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  buildOwnershipRevokedEmail,
} from '@/lib/email/templates'
import { createEmailPreferences } from '@/lib/services/email-lifecycle'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateReportStatus } from '@/lib/services/reports'
import { updateFeedbackStatus, syncSentryFeedback } from '@/lib/services/feedback'
import type { FeedbackStatus } from '@/lib/services/feedback'
import { checkAllServices } from '@/lib/services/health-checks'
import {
  setAppSetting,
  SUBCATEGORY_FILTER_KEY,
} from '@/lib/services/app-settings'
import { DENIAL_REASONS, type DenialReason, type OtherUrl } from '@/lib/types'
import { getSiteUrl } from '@/lib/site-url'
import { revalidatePublicBrand } from '@/lib/cache/public-brand-cache'

async function getPendingEditEmailContext(
  editId: string
): Promise<{ brandId: string; brandName: string; ownerEmail: string | null }> {
  const edit = await getPendingEditForReview(editId)

  return {
    brandId: edit.brandId,
    brandName: edit.brandName,
    ownerEmail: await getBrandOwnerEmail(edit.brandId),
  }
}

export async function approveSubmissionAction(
  submissionId: string,
  overrides?: SubmissionApprovalOverrides
): Promise<{ error?: string; imageSyncWarning?: { synced: number; failed: number } } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const siteUrl = getSiteUrl()

    const { brandId, submitterEmail, brandName, isBrandOwner } = await approveSubmission(submissionId, auth.user.id, overrides)
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

    if (overrides?.mitSmileCert) {
      try {
        const mitResult = await verifyMitByCert(brandId, overrides.mitSmileCert)
        if (mitResult.error) {
          console.warn('[admin:approveSubmission] MIT auto-verify skipped:', mitResult.error)
        }
      } catch (err) {
        console.warn('[admin:approveSubmission] MIT auto-verify error:', err)
      }
    }

    const existingOwnedBrand = isBrandOwner
      ? await getUserBrandByEmail(submitterEmail)
      : null

    const shouldEmailSubmitter = !isGeneratedGuestSubmissionEmail(submitterEmail)

    if (isBrandOwner && !existingOwnedBrand) {
      const token = await generateClaimToken(brandId, submitterEmail, brandName)
      const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
      sendEmail(await buildClaimEmail({
        submitterEmail,
        brandName,
        claimUrl,
        siteUrl,
      }))
    } else if (shouldEmailSubmitter) {
      sendEmail(await buildApprovalEmail({
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

    if (!isGeneratedGuestSubmissionEmail(submission.submitterEmail)) {
      sendEmail(await buildRejectionEmail({
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

export async function approveClaimAction(
  claimRequestId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = getSiteUrl()
    await approveClaimRequest(claimRequestId, auth.user.id)

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

    return undefined
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
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = getSiteUrl()
    await rejectClaimRequest(claimRequestId, auth.user.id, notes)

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

    return undefined
  } catch (err) {
    console.error('[admin:rejectClaimAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function approvePendingEditAction(
  editId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const edit = await getPendingEditEmailContext(editId)
    const previousBrand = await getBrandById(edit.brandId)
    await approvePendingEdit(editId, auth.user.id)
    const updatedBrand = await getBrandById(edit.brandId)

    try {
      await markFlagsReviewed(edit.brandId)
    } catch (err) {
      console.error('[admin] markFlagsReviewed failed:', err)
    }

    try {
      if (edit.ownerEmail && edit.brandName) {
        const locale = await getOwnerLocale(edit.brandId)
        await sendEmail(await buildEditApprovedEmail({
          brandName: edit.brandName,
          ownerEmail: edit.ownerEmail,
          locale,
        }))
      }
    } catch (err) {
      console.error('[edit-approved-email] send failed', err)
    }

    revalidatePath('/admin/edits')
    revalidatePath('/admin')
    revalidatePublicBrand({
      slug: updatedBrand.slug,
      previousSlug: previousBrand.slug,
    })

    return undefined
  } catch (err) {
    console.error('[admin:approvePendingEditAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function rejectPendingEditAction(
  editId: string,
  notes?: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    const edit = await getPendingEditEmailContext(editId)
    await rejectPendingEdit(editId, auth.user.id, notes)

    try {
      if (edit.ownerEmail && edit.brandName) {
        const locale = await getOwnerLocale(edit.brandId)
        await sendEmail(await buildEditRejectedEmail({
          brandName: edit.brandName,
          ownerEmail: edit.ownerEmail,
          notes,
          locale,
        }))
      }
    } catch (err) {
      console.error('[edit-rejected-email] send failed', err)
    }

    revalidatePath('/admin/edits')
    revalidatePath('/admin')

    return undefined
  } catch (err) {
    console.error('[admin:rejectPendingEditAction]', err)
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
    const moderationPayload = {
      fields: {
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
      },
      brandName: name ?? '',
    }
    const moderationResult = scanContent(moderationPayload)
    if (moderationResult.flags.length > 0) {
      try {
        await saveModerationFlags(brandId, auth.user.id, moderationResult.flags)
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

    sendEmail(await buildOwnershipRevokedEmail({
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

export async function reviewFeedbackAction(
  feedbackId: string,
  decision: FeedbackStatus
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return auth

    await updateFeedbackStatus(feedbackId, decision)
    revalidatePath('/admin/feedback')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:reviewFeedback]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

export async function syncSentryFeedbackAction(): Promise<
  { synced: number } | { error: string }
> {
  try {
    const auth = await requireAdminAction()
    if ('error' in auth) return { error: auth.error }

    const { synced } = await syncSentryFeedback()
    revalidatePath('/admin/feedback')
    revalidatePath('/admin')
    return { synced }
  } catch (err) {
    console.error('[admin:syncSentry]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

export async function refreshHealthChecks(): Promise<void> {
  const auth = await requireAdminAction()
  if ('error' in auth) {
    return
  }
  try {
    await checkAllServices()
  } catch (err) {
    console.error('[admin:refreshHealthChecks]', err)
  }
  revalidatePath('/admin')
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

    if (key !== SUBCATEGORY_FILTER_KEY) {
      return { error: 'Unknown feature flag' }
    }

    await setAppSetting(key, enabled)
    revalidatePath('/brands')
    revalidatePath('/en/brands')
    revalidatePath('/admin')
    return {}
  } catch (err) {
    console.error('[admin:setFeatureFlag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
