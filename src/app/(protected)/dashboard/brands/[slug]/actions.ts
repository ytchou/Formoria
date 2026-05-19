'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { getBrandBySlug, updateBrand } from '@/lib/services/brands'
import { checkContent } from '@/lib/services/moderation'

type ActionState = {
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

export async function updateBrandAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'You must be signed in to edit a brand' }
    }

    const brandSlug = formData.get('brandSlug') as string
    if (!brandSlug) {
      return { error: 'Missing brand slug' }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)

    if (!owner) {
      return { error: 'You do not have permission to edit this brand' }
    }

    // Extract editable fields
    const name = formData.get('name') as string | null
    const description = formData.get('description') as string | null
    const websiteUrl = formData.get('websiteUrl') as string | null
    const instagram = formData.get('instagram') as string | null
    const threads = formData.get('threads') as string | null
    const facebook = formData.get('facebook') as string | null

    // Build fields to check for moderation
    const fieldsToCheck: Record<string, string> = {}
    if (name) fieldsToCheck.name = name
    if (description) fieldsToCheck.description = description

    // Run moderation
    const moderation = checkContent(fieldsToCheck)

    if (moderation.isBlocked) {
      const fieldErrors: Record<string, string> = {}
      for (const blocked of moderation.blocked) {
        fieldErrors[blocked.field] = blocked.reason
      }
      return { fieldErrors }
    }

    // Update brand
    const updateData: Record<string, unknown> = {}
    if (name) updateData.name = name
    if (description !== null) updateData.description = description
    if (websiteUrl !== null || instagram !== null || threads !== null || facebook !== null) {
      updateData.socialLinks = {
        ...brand.socialLinks,
        ...(websiteUrl !== null ? { officialWebsite: websiteUrl || undefined } : {}),
        ...(instagram !== null ? { instagram: instagram || undefined } : {}),
        ...(threads !== null ? { threads: threads || undefined } : {}),
        ...(facebook !== null ? { facebook: facebook || undefined } : {}),
      }
    }

    await updateBrand(brand.id, updateData as Parameters<typeof updateBrand>[1])

    // Record flags for Tier 2 content
    if (moderation.flagged.length > 0) {
      const serviceClient = createServiceClient()
      const flagRecords = moderation.flagged.map((flag) => ({
        brand_id: brand.id,
        user_id: user.id,
        field_name: flag.field,
        flagged_content: flag.content,
        flag_reason: flag.reason,
        tier: flag.tier,
        status: 'pending' as const,
      }))

      await serviceClient.from('moderation_flags').insert(flagRecords)
    }

    revalidatePath(`/brands/${brandSlug}`)
    revalidatePath(`/dashboard/brands/${brandSlug}`)
  } catch (err) {
    console.error('[brand:updateBrandAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }

  const brandSlug = formData.get('brandSlug') as string
  redirect(`/dashboard/brands/${brandSlug}`)
}
