'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/admin'
import { getSubmission, approveSubmission, rejectSubmission } from '@/lib/services/submissions'
import { createBrand, updateBrand, deleteBrand, generateSlug, syncBrandImages } from '@/lib/services/brands'
import { createTag, updateTag, mergeTag, deactivateTag } from '@/lib/services/taxonomy'
import { createResendProvider } from '@/lib/email/resend-adapter'
import { buildApprovalEmail, buildRejectionEmail, buildClaimEmail } from '@/lib/email/templates'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateFlagStatus } from '@/lib/services/moderation'
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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mitmap.tw'

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

    await updateBrand(brandId, data as Parameters<typeof updateBrand>[1])

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

export async function revertFlagAction(
  flagId: string
): Promise<{ success: true } | { error: 'stale' | 'not_found' }> {
  const auth = await requireAdmin()
  if ('error' in auth) throw new Error(auth.error)

  const supabase = createServiceClient()

  // 1. Fetch the flag
  const { data: flag, error: flagErr } = await supabase
    .from('moderation_flags')
    .select('id, brand_id, field_name, flagged_content, previous_content')
    .eq('id', flagId)
    .single()

  if (flagErr || !flag) return { error: 'not_found' }

  // 2. If no previous content to revert to, it's stale
  if (!flag.previous_content) return { error: 'stale' }

  // 3. Fetch the current brand field value to check staleness
  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .select('id, description, name, social_links')
    .eq('id', flag.brand_id)
    .single()

  if (brandErr || !brand) return { error: 'not_found' }

  // 4. Map field_name to the current brand value
  function getCurrentValue(fieldName: string, brand: any): string | null {
    switch (fieldName) {
      case 'name': return brand.name ?? null
      case 'description': return brand.description ?? null
      case 'websiteUrl': return brand.social_links?.officialWebsite ?? null
      case 'instagram': return brand.social_links?.instagram ?? null
      case 'threads': return brand.social_links?.threads ?? null
      case 'facebook': return brand.social_links?.facebook ?? null
      default: return null
    }
  }

  const currentValue = getCurrentValue(flag.field_name, brand)

  // 5. Stale check — if the brand field no longer matches the flagged content, revert is no longer safe
  if (currentValue !== flag.flagged_content) return { error: 'stale' }

  // 6. Build the update payload for the brand
  function buildBrandUpdate(fieldName: string, previousContent: string, brand: any): Record<string, unknown> {
    if (['websiteUrl', 'instagram', 'threads', 'facebook'].includes(fieldName)) {
      const socialLinks = { ...(brand.social_links ?? {}) }
      const socialKey: Record<string, string> = {
        websiteUrl: 'officialWebsite',
        instagram: 'instagram',
        threads: 'threads',
        facebook: 'facebook',
      }
      socialLinks[socialKey[fieldName]] = previousContent
      return { social_links: socialLinks }
    }
    return { [fieldName]: previousContent }
  }

  const brandUpdate = buildBrandUpdate(flag.field_name, flag.previous_content, brand)

  const { error: updateBrandErr } = await supabase
    .from('brands')
    .update(brandUpdate)
    .eq('id', flag.brand_id)

  if (updateBrandErr) throw new Error(updateBrandErr.message)

  // 7. Mark flag as reviewed
  await updateFlagStatus(flagId, 'reviewed')

  revalidatePath('/admin/flagged')
  if (brand) {
    // revalidate brand page if slug is available — best effort
    const { data: brandWithSlug } = await supabase
      .from('brands')
      .select('slug')
      .eq('id', flag.brand_id)
      .single()
    if (brandWithSlug?.slug) {
      revalidatePath(`/brands/${brandWithSlug.slug}`)
    }
  }

  return { success: true }
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
