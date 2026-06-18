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
import {
  createBrand,
  curatedSubmissionSchema,
  deleteBrand,
  findSimilarBrands,
  generateSlug,
  getBrandById,
  isReservedSlug,
  normalizeRow,
  parseBrandCSV,
  syncBrandImages,
  updateBrand,
} from '@/lib/services/brands'
import type { CuratedSubmissionInput, SimilarBrand } from '@/lib/services/brands'
import { getBrandOwnerEmail } from '@/lib/services/brand-owners'
import { scanContent, saveModerationFlags, markFlagsReviewed } from '@/lib/services/moderation'
import type { ModerationFlag } from '@/lib/services/moderation'
import { submitBrandForReview } from '@/lib/services/submission-pipeline'
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
import { checkAllServices } from '@/lib/services/health-checks'
import type { TagCategory } from '@/lib/types'
import { PRODUCT_TYPE_CATEGORIES, deriveCategoryFromProductType } from '@/lib/taxonomy/ontology'

export type ImportPreviewStatus = 'valid' | 'duplicate' | 'needs-review' | 'error'

export type ImportPreviewRow = {
  rowIndex: number
  name: string
  slug: string
  validatedData: Record<string, unknown>
  status: ImportPreviewStatus
  reason?: string
  moderationFlags?: ModerationFlag[]
}

export type ImportExecuteResult = {
  rowIndex: number
  name: string
  status: 'created' | 'error'
  error?: string
}

function isStructuredTags(v: unknown): v is { region?: string; values?: string[]; productType?: string } {
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
        productType: 'crafts',
        foundingYear: null,
        socialInstagram: submission.socialInstagram,
        socialThreads: submission.socialThreads,
        socialFacebook: submission.socialFacebook,
        purchaseWebsite: submission.purchaseWebsite,
        purchasePinkoi: submission.purchasePinkoi,
        purchaseShopee: submission.purchaseShopee,
        otherUrls: submission.otherUrls,
        retailLocations: [],
        productPhotos: [],
        contactEmail: submission.submitterEmail,
        brandHighlights: null,
        siteContent: null,
        unifiedBusinessNumber: submission.unifiedBusinessNumber ?? null,
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
      await markFlagsReviewed(brand.id)
    } catch (err) {
      console.error('[admin] markFlagsReviewed failed:', err)
    }

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

        if (structuredTags.productType) {
          await updateBrand(brand.id, { productType: structuredTags.productType })
        }
      }
    } catch (err) {
      console.error('[admin:approveSubmission] tag application failed:', err)
    }

    if (submission.isBrandOwner) {
      const token = await generateClaimToken(brand.id, submission.submitterEmail, submission.brandName)
      const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
      sendEmail(await buildClaimEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        claimUrl,
        siteUrl,
      }))
    } else {
      sendEmail(await buildApprovalEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        brandSlug: slug,
        siteUrl,
      }))
    }

    revalidatePath('/admin/review-queue/submissions')
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

    sendEmail(await buildRejectionEmail({
      submitterEmail: submission.submitterEmail,
      brandName: submission.brandName,
      reviewerNotes: notes,
    }))

    revalidatePath('/admin/review-queue/submissions')
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

    revalidatePath('/admin/claims')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')

    if (claimRequest.brandSlug) {
      revalidatePath('/[locale]/brands/[slug]', 'page')
    }

    try {
      if (claimRequest.requesterEmail && claimRequest.brandName && claimRequest.brandSlug) {
        await sendEmail(await buildClaimApprovedEmail({
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

    revalidatePath('/admin/claims')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')

    if (claimRequest.brandSlug) {
      revalidatePath('/[locale]/brands/[slug]', 'page')
    }

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
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const edit = await getPendingEditEmailContext(editId)
    await approvePendingEdit(editId, auth.userId)

    try {
      await markFlagsReviewed(edit.brandId)
    } catch (err) {
      console.error('[admin] markFlagsReviewed failed:', err)
    }

    try {
      if (edit.ownerEmail && edit.brandName) {
        await sendEmail(await buildEditApprovedEmail(edit.brandName, edit.ownerEmail))
      }
    } catch (err) {
      console.error('[edit-approved-email] send failed', err)
    }

    revalidatePath('/admin/review-queue/edits')
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
        await sendEmail(await buildEditRejectedEmail(edit.brandName, edit.ownerEmail, notes))
      }
    } catch (err) {
      console.error('[edit-rejected-email] send failed', err)
    }

    revalidatePath('/admin/review-queue/edits')
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
        sendEmail(await buildMitVerificationApprovedEmail({
          to: ownerEmail,
          brandName: brand.name,
        }))
      }
    } catch (err) {
      console.error('[mit-verification-approved-email] send failed', err)
    }

    revalidatePath('/admin/claims')
    revalidatePath('/admin/catalog/brands')
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
        sendEmail(await buildMitVerificationNeedsDocsEmail({
          to: ownerEmail,
          brandName: brand.name,
          notes: trimmedNotes,
        }))
      }
    } catch (err) {
      console.error('[mit-verification-needs-docs-email] send failed', err)
    }

    revalidatePath('/admin/claims')
    revalidatePath('/admin/catalog/brands')
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
        sendEmail(await buildMitVerificationSubmittedEmail({
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
  data: {
    name?: string
    description?: string
    category?: string
    status?: string
    brandHighlights?: string
    website?: string
    purchaseUrl?: string
    productType?: string
  }
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateBrand(brandId, data as Parameters<typeof updateBrand>[1])

    if (data.category !== undefined) {
      const category = PRODUCT_TYPE_CATEGORIES.find((c) => c.nameZh === data.category)
      if (category) {
        const tag = await getTagBySlug(category.slug)
        if (tag) await addTagToBrand(brandId, tag.id)
      }
    }

    const { name, description, brandHighlights, website, purchaseUrl } = data
    const moderationPayload = {
      fields: { name, description, brandHighlights, website, purchaseUrl },
      brandName: name ?? '',
    }
    const moderationResult = scanContent(moderationPayload)
    if (moderationResult.flags.length > 0) {
      try {
        await saveModerationFlags(brandId, auth.userId, moderationResult.flags)
        await markFlagsReviewed(brandId)
      } catch (err) {
        console.error('[admin] god-mode moderation audit failed:', err)
      }
    }

    revalidatePath('/admin/catalog/brands')
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

    revalidatePath('/admin/catalog/brands')
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

    revalidatePath('/admin/catalog/brands')
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

    revalidatePath('/admin/catalog/brands')
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

    revalidatePath('/admin/catalog/brands')
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

    revalidatePath('/admin/catalog/taxonomy')
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

    revalidatePath('/admin/catalog/taxonomy')
    revalidatePath('/admin')
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

    revalidatePath('/admin/catalog/taxonomy')
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

    revalidatePath('/admin/catalog/taxonomy')
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

    revalidatePath('/admin/catalog/taxonomy')
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

    revalidatePath('/admin/catalog/brands')
    revalidatePath('/admin/catalog/taxonomy')
    revalidatePath('/admin')
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

    revalidatePath('/admin/catalog/brands')
    revalidatePath('/admin/catalog/taxonomy')
    revalidatePath('/admin')
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

    revalidatePath('/admin/signals/reports')
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
    revalidatePath('/admin/signals/feedback')
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
    const auth = await requireAdmin()
    if ('error' in auth) return { error: auth.error }

    const { synced } = await syncSentryFeedback()
    revalidatePath('/admin/signals/feedback')
    revalidatePath('/admin')
    return { synced }
  } catch (err) {
    console.error('[admin:syncSentry]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

type BulkImportValidatedData = CuratedSubmissionInput & {
  productType?: string
  productTypeNote?: string | null
  unifiedBusinessNumber?: string | null
}

function buildBulkImportModerationPayload(data: BulkImportValidatedData) {
  return {
    fields: {
      name: data.name,
      description: data.description,
      website: data.socialLinks.website,
      purchaseUrl: data.purchaseLinks[0]?.url,
    },
    brandName: data.name,
  }
}

function parseBulkImportValidatedData(data: Record<string, unknown>): BulkImportValidatedData {
  return curatedSubmissionSchema.parse(data) as BulkImportValidatedData
}

export async function previewBulkImportAction(
  csvText: string
): Promise<{ error?: string; rows: ImportPreviewRow[] }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return { error: auth.error, rows: [] }

    const rawRows = parseBrandCSV(csvText)
    if (rawRows.length === 0) {
      return { error: 'CSV 沒有可匯入的資料列', rows: [] }
    }

    const rows: ImportPreviewRow[] = []
    const duplicateCandidates: ImportPreviewRow[] = []

    rawRows.forEach((rawRow, index) => {
      let normalized: CuratedSubmissionInput
      try {
        normalized = normalizeRow(rawRow)
      } catch (err) {
        const name =
          typeof rawRow.name === 'string'
            ? rawRow.name.trim()
            : rawRow.name == null
              ? ''
              : String(rawRow.name).trim()

        rows.push({
          rowIndex: index + 1,
          name,
          slug: '',
          validatedData: {},
          status: 'error',
          reason: err instanceof Error ? err.message : '資料格式錯誤',
        })
        return
      }

      const parsed = curatedSubmissionSchema.safeParse(normalized)
      if (!parsed.success) {
        rows.push({
          rowIndex: index + 1,
          name: normalized.name,
          slug: '',
          validatedData: {},
          status: 'error',
          reason: parsed.error.issues.map((issue) => issue.message).join('; '),
        })
        return
      }

      const slug = generateSlug(parsed.data.name)
      if (!slug) {
        rows.push({
          rowIndex: index + 1,
          name: parsed.data.name,
          slug,
          validatedData: parsed.data,
          status: 'error',
          reason: '無法產生品牌網址代稱',
        })
        return
      }

      if (isReservedSlug(slug)) {
        rows.push({
          rowIndex: index + 1,
          name: parsed.data.name,
          slug,
          validatedData: parsed.data,
          status: 'error',
          reason: `品牌網址代稱與保留路由衝突：${slug}`,
        })
        return
      }

      const validatedData = { ...parsed.data, slug } as BulkImportValidatedData
      const moderationResult = scanContent(buildBulkImportModerationPayload(validatedData))

      if (moderationResult.riskLevel === 'high') {
        rows.push({
          rowIndex: index + 1,
          name: parsed.data.name,
          slug,
          validatedData,
          status: 'error',
          reason: '內容審核風險過高',
          moderationFlags: moderationResult.flags,
        })
        return
      }

      if (moderationResult.riskLevel === 'medium') {
        rows.push({
          rowIndex: index + 1,
          name: parsed.data.name,
          slug,
          validatedData,
          status: 'needs-review',
          reason: '內容需人工審核',
          moderationFlags: moderationResult.flags,
        })
        return
      }

      const previewRow: ImportPreviewRow = {
        rowIndex: index + 1,
        name: parsed.data.name,
        slug,
        validatedData,
        status: 'valid',
      }
      rows.push(previewRow)
      duplicateCandidates.push(previewRow)
    })

    const similarBrands = await findSimilarBrands(duplicateCandidates.map((row) => row.name))
    const bestMatches = new Map<string, SimilarBrand>()

    for (const match of similarBrands) {
      const current = bestMatches.get(match.inputName)
      if (!current || match.score > current.score) {
        bestMatches.set(match.inputName, match)
      }
    }

    for (const row of duplicateCandidates) {
      const match = bestMatches.get(row.name)
      if (match) {
        row.status = 'duplicate'
        row.reason = `可能與「${match.brandName}」重複（${Math.round(match.score * 100)}%）`
      }
    }

    return { rows }
  } catch (err) {
    console.error('[admin:previewBulkImport]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
      rows: [],
    }
  }
}

export async function executeBulkImportAction(
  selectedRows: ImportPreviewRow[]
): Promise<{ error?: string; results: ImportExecuteResult[] }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return { error: auth.error, results: [] }

    if (selectedRows.length === 0) {
      return { results: [] }
    }

    const results: ImportExecuteResult[] = []

    for (const row of selectedRows) {
      try {
        if (row.status === 'error') {
          throw new Error(row.reason ?? '此列不可匯入')
        }

        const data = parseBulkImportValidatedData(row.validatedData)
        const category = deriveCategoryFromProductType(
          data.productType ?? '',
          data.productTypeNote,
        )
        const socialLinks = {
          instagram: data.socialLinks.instagram || undefined,
          threads: data.socialLinks.threads || undefined,
          facebook: data.socialLinks.facebook || undefined,
          officialWebsite: data.socialLinks.website || undefined,
        }

        await submitBrandForReview({
          name: data.name,
          slug: row.slug,
          description: data.description,
          logoUrl: data.logoUrl ?? null,
          category,
          purchaseLinks: data.purchaseLinks.map((link) => ({
            ...link,
            label: link.platform,
          })),
          socialLinks,
          retailLocations: data.retailLocations.map((location) => ({
            ...location,
            latitude: 0,
            longitude: 0,
          })),
          productPhotos: data.productPhotos,
          contactEmail: null,
          brandHighlights: data.brandHighlights,
          unifiedBusinessNumber: data.unifiedBusinessNumber ?? null,
          submitterEmail: auth.email,
          submitterName: 'Bulk Import',
          isBrandOwner: false,
          sourceAttribution: null,
          pdpaConsentAt: new Date().toISOString(),
          region: data.region,
          valueTags: data.valueTags,
          productType: data.productType,
          productTypeNote: data.productTypeNote ?? null,
          moderationFlags: row.moderationFlags,
          moderatorUserId: auth.userId,
        } as Parameters<typeof submitBrandForReview>[0])

        results.push({
          rowIndex: row.rowIndex,
          name: data.name,
          status: 'created',
        })
      } catch (err) {
        results.push({
          rowIndex: row.rowIndex,
          name: row.name,
          status: 'error',
          error: err instanceof Error ? err.message : '匯入失敗',
        })
      }
    }

    revalidatePath('/admin/review-queue/submissions')
    revalidatePath('/admin')
    return { results }
  } catch (err) {
    console.error('[admin:executeBulkImport]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
      results: [],
    }
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
    revalidatePath('/admin/signals/reports')
    revalidatePath('/admin')
  }

  return { updated, errors }
}

export async function refreshHealthChecks(): Promise<void> {
  await requireAdmin()
  try {
    await checkAllServices()
  } catch (err) {
    console.error('[admin:refreshHealthChecks]', err)
  }
  revalidatePath('/admin')
}
