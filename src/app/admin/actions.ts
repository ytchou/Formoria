'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { getSubmission, approveSubmission, rejectSubmission } from '@/lib/services/submissions'
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
import { verifyMitStatus, rejectMitStatus } from '@/lib/services/mit-verification'
import { createBrand, updateBrand, getBrandById, deleteBrand, generateSlug, syncBrandImages } from '@/lib/services/brands'
import { getBrandOwnerEmail } from '@/lib/services/brand-owners'
import {
  createTag,
  updateTag,
  mergeTag,
  deactivateTag,
  activateTag,
  setBrandTags,
  getTagBySlug,
  addTagToBrand,
} from '@/lib/services/taxonomy'
import { sendEmail } from '@/lib/email/send'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  buildMitVerificationSubmittedEmail,
  buildMitVerificationApprovedEmail,
  buildMitVerificationNeedsDocsEmail,
} from '@/lib/email/templates'
import { createEmailPreferences } from '@/lib/services/email-lifecycle'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateReportStatus } from '@/lib/services/reports'
import { updateFeedbackStatus, syncSentryFeedback } from '@/lib/services/feedback'
import type { FeedbackStatus } from '@/lib/services/feedback'
import type { TagCategory } from '@/lib/types'

function isStructuredTags(v: unknown): v is { region?: string; values?: string[] } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}


async function requireAdmin(): Promise<{ userId: string; email: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: 'You must authenticate to perform this action' }
  }

  if (!(await isActingAsAdmin(user.email))) {
    return { error: 'You are not authorized to perform this action' }
  }

  return { userId: user.id, email: user.email ?? '' }
}

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
  submissionId: string
): Promise<{ error?: string; imageSyncWarning?: { synced: number; failed: number } } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const submission = await getSubmission(submissionId)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'

    let brand: Awaited<ReturnType<typeof createBrand>>
    let slug: string
    let imageSyncWarning: { synced: number; failed: number } | undefined

    if (submission.brandId == null) {
      // Legacy path: no linked brand — create a minimal one
      slug = generateSlug(submission.brandName)
      brand = await createBrand({
        name: submission.brandName,
        slug,
        description: submission.description,
        logoUrl: null,
        heroImageUrl: null,
        status: 'approved',
        isVerified: false,
        isDemo: false,
        category: null,
        foundingYear: null,
        purchaseLinks: [],
        socialLinks: submission.socialLinks,
        retailLocations: [],
        productPhotos: [],
        contactEmail: submission.submitterEmail,
        brandHighlights: null,
        siteContent: null,
      })
      slug = brand.slug
    } else {
      // New path: brand already exists — approve it and sync images
      brand = await updateBrand(submission.brandId, { status: 'approved' })
      slug = brand.slug

      try {
        const syncResult = await syncBrandImages(submission.brandId)
        if (syncResult.failed > 0) imageSyncWarning = syncResult
      } catch (syncErr) {
        console.error('[admin:approveSubmission] syncBrandImages failed:', syncErr)
      }
    }

    await approveSubmission(submissionId, auth.userId)

    try {
      const { suggestedTags } = submission
      if (isStructuredTags(suggestedTags)) {
        const structuredTags = suggestedTags

        if (structuredTags.region) {
          const tag = await getTagBySlug(structuredTags.region)
          if (tag) await addTagToBrand(brand.id, tag.id)
        }

        if (Array.isArray(structuredTags.values)) {
          await Promise.all(
            structuredTags.values.map(async (slug) => {
              const tag = await getTagBySlug(slug)
              if (tag) await addTagToBrand(brand.id, tag.id)
            })
          )
        }
      }
    } catch (err) {
      console.error('[admin:approveSubmission] tag application failed:', err)
    }

    if (submission.isBrandOwner) {
      const token = await generateClaimToken(brand.id, submission.submitterEmail, submission.brandName)
      const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
      sendEmail(buildClaimEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        claimUrl,
        siteUrl,
      }))
    } else {
      sendEmail(buildApprovalEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        brandSlug: slug,
        siteUrl,
      }))
    }

    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
    return imageSyncWarning ? { imageSyncWarning } : undefined
  } catch (err) {
    console.error('[admin:approveSubmission]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function rejectSubmissionAction(
  submissionId: string,
  notes: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const submission = await getSubmission(submissionId)
    await rejectSubmission(submissionId, auth.userId, notes)

    sendEmail(buildRejectionEmail({
      submitterEmail: submission.submitterEmail,
      brandName: submission.brandName,
      reviewerNotes: notes,
    }))

    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'
    await approveClaimRequest(claimRequestId, auth.userId)

    try {
      const serviceSupabase = createServiceClient()
      await createEmailPreferences(serviceSupabase, claimRequest.userId)
    } catch (err) {
      console.error('[claim-approved-email-preferences] create failed', err)
    }

    revalidatePath('/admin/claim-requests')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')

    if (claimRequest.brandSlug) {
      revalidatePath('/[locale]/brands/[slug]', 'page')
    }

    try {
      if (claimRequest.requesterEmail && claimRequest.brandName && claimRequest.brandSlug) {
        await sendEmail(buildClaimApprovedEmail({
          ownerEmail: claimRequest.requesterEmail,
          brandName: claimRequest.brandName,
          brandSlug: claimRequest.brandSlug,
          siteUrl,
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const claimRequest = await getClaimRequest(claimRequestId)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'
    await rejectClaimRequest(claimRequestId, auth.userId, notes)

    revalidatePath('/admin/claim-requests')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')

    if (claimRequest.brandSlug) {
      revalidatePath('/[locale]/brands/[slug]', 'page')
    }

    try {
      if (claimRequest.requesterEmail && claimRequest.brandName) {
        await sendEmail(buildClaimRejectedEmail({
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const edit = await getPendingEditEmailContext(editId)
    await approvePendingEdit(editId, auth.userId)

    try {
      if (edit.ownerEmail && edit.brandName) {
        await sendEmail(buildEditApprovedEmail(edit.brandName, edit.ownerEmail))
      }
    } catch (err) {
      console.error('[edit-approved-email] send failed', err)
    }

    revalidatePath('/admin/pending-edits')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')
    revalidatePath('/[locale]/brands/[slug]', 'page')

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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const edit = await getPendingEditEmailContext(editId)
    await rejectPendingEdit(editId, auth.userId, notes)

    try {
      if (edit.ownerEmail && edit.brandName) {
        await sendEmail(buildEditRejectedEmail(edit.brandName, edit.ownerEmail, notes))
      }
    } catch (err) {
      console.error('[edit-rejected-email] send failed', err)
    }

    revalidatePath('/admin/pending-edits')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')
    revalidatePath('/[locale]/brands/[slug]', 'page')

    return undefined
  } catch (err) {
    console.error('[admin:rejectPendingEditAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function verifyMitAction(
  brandId: string,
  cert?: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    let resolvedCert = cert ?? null

    if (resolvedCert == null) {
      const supabase = await createClient()
      const { data: claimRequest, error: claimRequestError } = await supabase
        .from('claim_requests')
        .select('mit_smile_cert')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (claimRequestError) throw claimRequestError

      resolvedCert = claimRequest?.mit_smile_cert ?? null
    }

    const brand = await verifyMitStatus(brandId, resolvedCert, auth.userId)

    try {
      const ownerEmail = await getBrandOwnerEmail(brandId)
      if (ownerEmail) {
        sendEmail(buildMitVerificationApprovedEmail({
          to: ownerEmail,
          brandName: brand.name,
        }))
      }
    } catch (err) {
      console.error('[mit-verification-approved-email] send failed', err)
    }

    revalidatePath('/admin/claim-requests')
    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')
    revalidatePath('/[locale]/brands/[slug]', 'page')

    return undefined
  } catch (err) {
    console.error('[admin:verifyMitAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function rejectMitAction(
  brandId: string,
  notes: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const trimmedNotes = notes.trim()
    if (!trimmedNotes) {
      return { error: 'Rejection notes are required.' }
    }

    const brand = await rejectMitStatus(brandId, auth.userId, trimmedNotes)

    try {
      const ownerEmail = await getBrandOwnerEmail(brandId)
      if (ownerEmail) {
        sendEmail(buildMitVerificationNeedsDocsEmail({
          to: ownerEmail,
          brandName: brand.name,
          notes: trimmedNotes,
        }))
      }
    } catch (err) {
      console.error('[mit-verification-needs-docs-email] send failed', err)
    }

    revalidatePath('/admin/claim-requests')
    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')
    revalidatePath('/[locale]/brands/[slug]', 'page')

    return undefined
  } catch (err) {
    console.error('[admin:rejectMitAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function acknowledgeMitVerificationSubmissionAction(
  brandId: string
): Promise<{ success: boolean } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const brand = await getBrandById(brandId)

    try {
      const ownerEmail = await getBrandOwnerEmail(brandId)
      if (ownerEmail) {
        sendEmail(buildMitVerificationSubmittedEmail({
          to: ownerEmail,
          brandName: brand.name,
        }))
      }
    } catch (err) {
      console.error('[mit-verification-submitted-email] send failed', err)
    }

    return { success: true }
  } catch (err) {
    console.error('[admin:acknowledgeMitVerificationSubmissionAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function updateBrandAction(
  brandId: string,
  data: { name?: string; description?: string; category?: string; status?: string }
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateBrand(brandId, data as Parameters<typeof updateBrand>[1])

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateBrand(brandId, { status: 'hidden' })

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateBrand(brandId, { status: 'approved' })

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await deleteBrand(brandId)

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
    return undefined
  } catch (err) {
    console.error('[admin:deleteBrand]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function resyncBrandImagesAction(
  brandId: string
): Promise<{ error?: string; synced?: number; failed?: number }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const brand = await getBrandById(brandId)
    const result = await syncBrandImages(brandId)

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
    revalidatePath('/')
    revalidatePath('/brands')
    revalidatePath(`/brands/${brand.slug}`)
    return result
  } catch (err) {
    console.error('[admin:resyncBrandImages]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

export async function createTagAction(
  data: { name: string; category: string; nameZh?: string }
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await createTag({
      name: data.name,
      category: data.category as TagCategory,
      nameZh: data.nameZh,
    })

    revalidatePath('/admin/taxonomy')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:createTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function renameTagAction(
  tagId: string,
  name: string,
  nameZh?: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateTag(tagId, { name, nameZh })

    revalidatePath('/admin/taxonomy')
    return undefined
  } catch (err) {
    console.error('[admin:renameTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function mergeTagAction(
  sourceId: string,
  targetId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await mergeTag(sourceId, targetId)

    revalidatePath('/admin/taxonomy')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:mergeTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function deactivateTagAction(
  tagId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await deactivateTag(tagId)

    revalidatePath('/admin/taxonomy')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:deactivateTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function approveSuggestedTagAction(
  tagId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await activateTag(tagId)

    revalidatePath('/admin/taxonomy')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:approveSuggestedTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function setBrandTagsAction(
  formData: FormData
): Promise<{ success: true } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const brandId = formData.get('brandId')
    const tagIdsRaw = formData.get('tagIds')

    if (!brandId || typeof brandId !== 'string') {
      return { error: 'brandId is required' }
    }

    const tagIds: string[] = tagIdsRaw ? JSON.parse(tagIdsRaw as string) : []

    await setBrandTags(brandId, tagIds)

    revalidatePath('/admin/brands')
    revalidatePath('/admin/taxonomy')
    return { success: true }
  } catch (err) {
    console.error('[admin:setBrandTags]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function confirmBrandTagsAction(
  formData: FormData
): Promise<{ success: true } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const brandId = formData.get('brandId')
    const tagIdsRaw = formData.get('tagIds')

    if (!brandId || typeof brandId !== 'string') {
      return { error: 'brandId is required' }
    }

    const tagIds: string[] = tagIdsRaw ? JSON.parse(tagIdsRaw as string) : []

    await setBrandTags(brandId, tagIds)

    revalidatePath('/admin/brands')
    revalidatePath('/admin/taxonomy')
    return { success: true }
  } catch (err) {
    console.error('[admin:confirmBrandTags]', err)
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
    const auth = await requireAdmin()
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

export async function reviewFeedbackAction(
  feedbackId: string,
  decision: FeedbackStatus
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateFeedbackStatus(feedbackId, decision)
    revalidatePath('/admin/feedback')
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
    const auth = await requireAdmin()
    if ('error' in auth) return { error: auth.error }

    const { synced } = await syncSentryFeedback()
    revalidatePath('/admin/feedback')
    return { synced }
  } catch (err) {
    console.error('[admin:syncSentry]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

export async function bulkUpdateReportsAction(
  reportIds: string[],
  decision: 'reviewed' | 'dismissed'
): Promise<{ updated: number; errors: { id: string; error: string }[] }> {
  const auth = await requireAdmin()
  if ('error' in auth) throw new Error(auth.error)

  const errors: { id: string; error: string }[] = []
  let updated = 0

  for (const id of reportIds) {
    try {
      await updateReportStatus(id, decision)
      updated++
    } catch (err) {
      errors.push({
        id,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  if (updated > 0) {
    revalidatePath('/admin/reports')
    revalidatePath('/admin')
  }

  return { updated, errors }
}
