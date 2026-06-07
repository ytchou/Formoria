'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/admin'
import { getSubmission, approveSubmission, rejectSubmission } from '@/lib/services/submissions'
import {
  approveClaimRequest,
  getClaimRequest,
  getClaimRequestById,
  rejectClaimRequest,
} from '@/lib/services/claim-requests'
import { verifyMitStatus, rejectMitStatus } from '@/lib/services/mit-verification'
import { createBrand, updateBrand, getBrandById, deleteBrand, generateSlug, syncBrandImages } from '@/lib/services/brands'
import { createTag, updateTag, mergeTag, deactivateTag, activateTag, setBrandTags, processSuggestedTag } from '@/lib/services/taxonomy'
import { createResendProvider } from '@/lib/email/resend-adapter'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
} from '@/lib/email/templates'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateFlagStatus, getModerationFlag } from '@/lib/services/moderation'
import { updateReportStatus } from '@/lib/services/reports'
import type { TagCategory, Brand } from '@/lib/types'

async function requireAdmin(): Promise<{ userId: string; email: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: 'You must authenticate to perform this action' }
  }

  if (!isAdmin(user.email ?? '')) {
    return { error: 'You are not authorized to perform this action' }
  }

  return { userId: user.id, email: user.email ?? '' }
}

function sendEmail(email: Parameters<ReturnType<typeof createResendProvider>['send']>[0]) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[admin:email] RESEND_API_KEY not configured, skipping email')
    return
  }
  const provider = createResendProvider(apiKey)
  provider.send(email).catch((err) => {
    console.error('[admin:email]', err)
  })
}

export async function approveSubmissionAction(
  submissionId: string
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const submission = await getSubmission(submissionId)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'

    let brand: Awaited<ReturnType<typeof createBrand>>
    let slug: string

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
      })
      slug = brand.slug
    } else {
      // New path: brand already exists — approve it and sync images
      brand = await updateBrand(submission.brandId, { status: 'approved' })
      slug = brand.slug

      try {
        await syncBrandImages(submission.brandId)
      } catch (syncErr) {
        console.error('[admin:approveSubmission] syncBrandImages failed:', syncErr)
      }
    }

    await approveSubmission(submissionId, auth.userId)

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

    revalidatePath('/admin/claim-requests')
    revalidatePath('/admin')
    revalidatePath('/[locale]', 'page')
    revalidatePath('/[locale]/brands', 'page')

    if (claimRequest.brandSlug) {
      revalidatePath('/[locale]/brands/[slug]', 'page')
    }

    try {
      const claim = await getClaimRequestById(claimRequestId)
      if (claim?.requesterEmail && claim.brandName && claim.brandSlug) {
        await sendEmail(buildClaimApprovedEmail({
          ownerEmail: claim.requesterEmail,
          brandName: claim.brandName,
          brandSlug: claim.brandSlug,
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
      const claim = await getClaimRequestById(claimRequestId)
      if (claim?.requesterEmail && claim.brandName) {
        await sendEmail(buildClaimRejectedEmail({
          ownerEmail: claim.requesterEmail,
          brandName: claim.brandName,
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

    await verifyMitStatus(brandId, resolvedCert, auth.userId)

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

    await rejectMitStatus(brandId, auth.userId, trimmedNotes)

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

export async function reviewFlagAction(
  flagId: string,
  decision: 'reviewed' | 'dismissed'
): Promise<{ error: string } | undefined> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await updateFlagStatus(flagId, decision)

    revalidatePath('/admin/flagged')
    revalidatePath('/admin')
    return undefined
  } catch (err) {
    console.error('[admin:reviewFlag]', err)
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

export async function revertFlagAction(
  flagId: string
): Promise<{ success: true } | { error: 'stale' | 'not_found' }> {
  const auth = await requireAdmin()
  if ('error' in auth) throw new Error(auth.error)

  // 1. Fetch the flag via service layer
  const flag = await getModerationFlag(flagId)

  if (!flag) return { error: 'not_found' }

  // 2. If no previous content to revert to, it's stale
  if (!flag.previousContent) return { error: 'stale' }

  // 3. Fetch the current brand via service layer (properly typed, snake_case → camelCase decoded)
  let brand: Brand
  try {
    brand = await getBrandById(flag.brandId)
  } catch {
    return { error: 'not_found' }
  }

  // 4. Map fieldName to the current brand value using camelCase domain types
  function getCurrentValue(fieldName: string): string | null {
    switch (fieldName) {
      case 'name': return brand.name ?? null
      case 'description': return brand.description ?? null
      case 'websiteUrl': return brand.socialLinks.officialWebsite ?? null
      case 'instagram': return brand.socialLinks.instagram ?? null
      case 'threads': return brand.socialLinks.threads ?? null
      case 'facebook': return brand.socialLinks.facebook ?? null
      default: return null
    }
  }

  const currentValue = getCurrentValue(flag.fieldName)

  // 5. Stale check — if the brand field no longer matches the flagged content, revert is no longer safe
  if (currentValue !== flag.flaggedContent) return { error: 'stale' }

  // 6. Build the update payload using domain types — updateBrand handles snake_case mapping
  function buildBrandUpdate(fieldName: string, previousContent: string): Parameters<typeof updateBrand>[1] {
    if (['websiteUrl', 'instagram', 'threads', 'facebook'].includes(fieldName)) {
      return {
        socialLinks: {
          ...brand.socialLinks,
          [fieldName === 'websiteUrl' ? 'officialWebsite' : fieldName]: previousContent,
        },
      }
    }
    return { [fieldName]: previousContent } as Parameters<typeof updateBrand>[1]
  }

  await updateBrand(brand.id, buildBrandUpdate(flag.fieldName, flag.previousContent))

  // 7. Mark flag as reviewed
  await updateFlagStatus(flagId, 'reviewed')

  revalidatePath('/admin/flagged')
  revalidatePath(`/brands/${brand.slug}`)

  return { success: true }
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

    await setBrandTags(brandId, tagIds, 'manual')

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

    await setBrandTags(brandId, tagIds, 'manual')

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

export async function processSuggestedTagAction(
  formData: FormData
): Promise<{ success: true } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const submissionId = formData.get('submissionId')
    const action = formData.get('action')
    const targetTagId = formData.get('targetTagId') ?? undefined
    const newTagDataRaw = formData.get('newTagData') ?? undefined

    if (!submissionId || typeof submissionId !== 'string') {
      return { error: 'submissionId is required' }
    }
    if (!action || typeof action !== 'string') {
      return { error: 'action is required' }
    }

    const newTagData = newTagDataRaw ? JSON.parse(newTagDataRaw as string) : undefined

    await processSuggestedTag(
      submissionId,
      action as Parameters<typeof processSuggestedTag>[1],
      targetTagId as string | undefined,
      newTagData
    )

    revalidatePath('/admin/taxonomy')
    return { success: true }
  } catch (err) {
    console.error('[admin:processSuggestedTag]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function bulkUpdateFlagsAction(
  flagIds: string[],
  decision: 'reviewed' | 'dismissed'
): Promise<{ updated: number; errors: { id: string; message: string }[] }> {
  const auth = await requireAdmin()
  if ('error' in auth) throw new Error(auth.error)

  let updated = 0
  const errors: { id: string; message: string }[] = []

  for (const id of flagIds) {
    try {
      await updateFlagStatus(id, decision)
      updated++
    } catch (err) {
      errors.push({
        id,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  revalidatePath('/admin/flagged')

  return { updated, errors }
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
