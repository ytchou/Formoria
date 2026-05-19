'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/admin'
import { getSubmission, approveSubmission, rejectSubmission } from '@/lib/services/submissions'
import { createBrand, updateBrand, deleteBrand, generateSlug } from '@/lib/services/brands'
import { createTag, updateTag, mergeTag, deactivateTag } from '@/lib/services/taxonomy'
import { createResendProvider } from '@/lib/email/resend-adapter'
import { buildApprovalEmail, buildRejectionEmail } from '@/lib/email/templates'
import type { TagCategory } from '@/lib/types'

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
    const slug = generateSlug(submission.brandName)

    await createBrand({
      name: submission.brandName,
      slug,
      description: submission.description,
      logoUrl: null,
      heroImageUrl: null,
      status: 'approved',
      category: null,
      foundingYear: null,
      purchaseLinks: [],
      socialLinks: submission.socialLinks,
      retailLocations: [],
      productPhotos: [],
      contactEmail: submission.submitterEmail,
      founder: null,
      productHighlights: [],
    })

    await approveSubmission(submissionId, auth.userId)

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mitmap.tw'
    sendEmail(buildApprovalEmail({
      submitterEmail: submission.submitterEmail,
      brandName: submission.brandName,
      brandSlug: slug,
      siteUrl,
    }))

    revalidatePath('/admin/submissions')
    revalidatePath('/admin')
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
    return undefined
  } catch (err) {
    console.error('[admin:rejectSubmission]', err)
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

    await updateBrand(brandId, data)

    revalidatePath('/admin/brands')
    revalidatePath('/admin')
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
