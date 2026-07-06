'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { createPendingEdit } from '@/lib/services/pending-edits'
import { scanContent, shouldAutoApprove, saveModerationFlags } from '@/lib/services/moderation'
import { insertBrandImage, syncHeroDenormalized } from '@/lib/services/brand-images'
import {
  diffRemovedImageUrls,
  discardDraft,
  getBrandDraft,
  publishDraft,
  updateBrand,
} from '@/lib/services/brands'
import { createServiceClient } from '@/lib/supabase/server'
import { deleteBrandImages, storageKeyFromPublicUrl } from '@/lib/services/image-upload'
import { logAdminActionIfAdmin } from '@/lib/services/admin-audit'
import {
  isOnboardingStepKey,
  setBrandOnboardingStepStatus,
} from '@/lib/services/brand-onboarding'
import type { Brand } from '@/lib/types'
import type { ModerationResult } from '@/lib/services/moderation'
import {
  InvalidBrandEditFormError,
  parseBrandEditForm,
  buildModerationPayload,
} from './actions-utils'

type ActionState = {
  success?: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

async function completeOnboardingAfterOwnerSubmit(
  formData: FormData,
  brandId: string,
  userId: string,
  isOwner: boolean
): Promise<void> {
  const rawStep = formData.get('onboardingStep')
  if (!isOwner || typeof rawStep !== 'string' || !isOnboardingStepKey(rawStep)) return

  await setBrandOnboardingStepStatus({
    brandId,
    userId,
    step: rawStep,
    status: 'complete',
  })
  revalidatePath('/dashboard')
}

function imageUrlsFromBrand(brand: Pick<Brand, 'heroImageUrl' | 'productPhotos'>): string[] {
  return [
    brand.heroImageUrl,
    ...(brand.productPhotos ?? []),
  ].filter((url): url is string => Boolean(url))
}

function imageUrlsFromSnapshot(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) {
    return []
  }

  return [
    typeof snapshot.heroImageUrl === 'string' ? snapshot.heroImageUrl : null,
    ...(Array.isArray(snapshot.productPhotos)
      ? snapshot.productPhotos.filter((url): url is string => typeof url === 'string')
      : []),
  ].filter((url): url is string => Boolean(url))
}

async function saveModerationFlagsQuietly(
  brandId: string,
  userId: string,
  moderationResult: ModerationResult
): Promise<void> {
  if (moderationResult.flags.length === 0) {
    return
  }

  try {
    await saveModerationFlags(brandId, userId, moderationResult.flags)
  } catch (error) {
    console.error('[brand:moderation] saveModerationFlags failed:', error)
  }
}

async function syncOwnerUploadedImages(
  brandId: string,
  previousImageUrls: string[],
  nextImageUrls: string[]
): Promise<void> {
  const newImageUrls = nextImageUrls.filter((url) => !previousImageUrls.includes(url))
  if (newImageUrls.length === 0) return

  const supabase = createServiceClient()
  for (const url of newImageUrls) {
    await insertBrandImage(supabase, {
      brand_id: brandId,
      url,
      source: 'owner',
      source_url: url,
      storage_path: storageKeyFromPublicUrl(url),
      sort_order: nextImageUrls.indexOf(url),
    })
  }
  await syncHeroDenormalized(supabase, brandId)
}

async function applyBrandUpdate(
  brand: Brand,
  updateData: Partial<Brand>,
  options: { syncOwnerImages?: boolean } = {}
): Promise<void> {
  const previousImageUrls = imageUrlsFromBrand(brand)
  const nextImageUrls = imageUrlsFromBrand({ ...brand, ...updateData })
  const orphans = diffRemovedImageUrls(previousImageUrls, nextImageUrls)

  const updatedBrand = await updateBrand(brand.id, updateData)

  if (options.syncOwnerImages) {
    await syncOwnerUploadedImages(brand.id, previousImageUrls, nextImageUrls)
  }

  await deleteBrandImages(orphans)

  const { snapshot } = await discardDraft(brand.id)
  const draftOnlyImages = diffRemovedImageUrls(
    imageUrlsFromSnapshot(snapshot),
    imageUrlsFromBrand(updatedBrand)
  )
  await deleteBrandImages(draftOnlyImages)

  revalidatePath('/[locale]/brands/[slug]', 'page')
  revalidatePath('/dashboard')
}

export async function updateBrandAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getTranslations('dashboard.edit.errors')
  const brandSlug = formData.get('brandSlug') as string
  if (!brandSlug) {
    return { error: 'Missing brand slug' }
  }

  try {
    const editor = await requireBrandEditor(brandSlug)
    if ('error' in editor) {
      if (editor.error === 'notLoggedIn') {
        return { error: t('notLoggedIn') }
      }
      if (editor.error === 'forbidden') {
        return { error: t('forbidden') }
      }
      return { error: `Brand not found: ${brandSlug}` }
    }
    const { user, brand, owner, actingAdmin, configuredAdmin } = editor

    const updateData = parseBrandEditForm(formData)
    const proposedData = updateData as Record<string, unknown>
    const moderationResult = scanContent(buildModerationPayload(proposedData, brand.name))
    if (moderationResult.riskLevel === 'high') {
      return { error: t('unknown') }
    }

    if (!configuredAdmin) {
      const autoApprove = moderationResult.flags.length === 0
        ? await shouldAutoApprove(moderationResult, user.id)
        : false

      if (autoApprove) {
        await applyBrandUpdate(brand, updateData, { syncOwnerImages: owner })
        await completeOnboardingAfterOwnerSubmit(formData, brand.id, user.id, owner)
      } else {
        await createPendingEdit(brand.id, user.id, updateData as Record<string, unknown>)
        await saveModerationFlagsQuietly(brand.id, user.id, moderationResult)
        await completeOnboardingAfterOwnerSubmit(formData, brand.id, user.id, owner)
        return { success: true, message: 'brandEditSubmittedForReview' }
      }
    }

    await applyBrandUpdate(brand, updateData, { syncOwnerImages: owner })
    await completeOnboardingAfterOwnerSubmit(formData, brand.id, user.id, owner)
    await logAdminActionIfAdmin(actingAdmin, { id: user.id, email: user.email ?? null }, 'brand_edit', brandSlug, brand.id)
  } catch (err) {
    if (err instanceof InvalidBrandEditFormError) {
      return { error: err.message }
    }

    console.error('[brand:updateBrandAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard/brands/${brandSlug}`)
}

export async function publishDraftAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getTranslations('dashboard.edit.errors')
  const brandSlug = formData.get('brandSlug') as string
  if (!brandSlug) {
    return { error: 'Missing brand slug' }
  }

  try {
    const editor = await requireBrandEditor(brandSlug)
    if ('error' in editor) {
      if (editor.error === 'notLoggedIn') {
        return { error: t('notLoggedIn') }
      }
      if (editor.error === 'forbidden') {
        return { error: t('forbidden') }
      }
      return { error: `Brand not found: ${brandSlug}` }
    }
    const { user, brand, owner, actingAdmin, configuredAdmin } = editor

    const snapshot = await getBrandDraft(brand.id)
    if (!snapshot) {
      return { error: t('noDraft') }
    }

    const draftPartial = snapshot
    const moderationResult = scanContent(buildModerationPayload(draftPartial, brand.name))
    if (moderationResult.riskLevel === 'high') {
      return { error: t('unknown') }
    }

    if (!configuredAdmin) {
      const autoApprove = moderationResult.flags.length === 0
        ? await shouldAutoApprove(moderationResult, user.id)
        : false

      if (autoApprove) {
        const nextImageUrls = imageUrlsFromBrand({
          heroImageUrl: 'heroImageUrl' in snapshot
            ? (typeof snapshot.heroImageUrl === 'string' ? snapshot.heroImageUrl : null)
            : brand.heroImageUrl,
          productPhotos: 'productPhotos' in snapshot
            ? (Array.isArray(snapshot.productPhotos)
                ? snapshot.productPhotos.filter((url): url is string => typeof url === 'string')
                : [])
            : brand.productPhotos,
        })
        const orphans = diffRemovedImageUrls(imageUrlsFromBrand(brand), nextImageUrls)
        await publishDraft(brand.id)
        if (owner) {
          await syncOwnerUploadedImages(brand.id, imageUrlsFromBrand(brand), nextImageUrls)
        }
        await deleteBrandImages(orphans)

        revalidatePath('/[locale]/brands/[slug]', 'page')
        revalidatePath('/dashboard')
      } else {
        await createPendingEdit(brand.id, user.id, draftPartial)
        await saveModerationFlagsQuietly(brand.id, user.id, moderationResult)
        await discardDraft(brand.id)
        return { success: true, message: 'brandEditSubmittedForReview' }
      }
    }

    const nextImageUrls = imageUrlsFromBrand({
      heroImageUrl: 'heroImageUrl' in snapshot
        ? (typeof snapshot.heroImageUrl === 'string' ? snapshot.heroImageUrl : null)
        : brand.heroImageUrl,
      productPhotos: 'productPhotos' in snapshot
        ? (Array.isArray(snapshot.productPhotos)
            ? snapshot.productPhotos.filter((url): url is string => typeof url === 'string')
            : [])
        : brand.productPhotos,
    })
    const orphans = diffRemovedImageUrls(imageUrlsFromBrand(brand), nextImageUrls)
    await publishDraft(brand.id)
    if (owner) {
      await syncOwnerUploadedImages(brand.id, imageUrlsFromBrand(brand), nextImageUrls)
    }
    await deleteBrandImages(orphans)
    await logAdminActionIfAdmin(actingAdmin, { id: user.id, email: user.email ?? null }, 'draft_publish', brandSlug, brand.id)

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath('/dashboard')
  } catch (err) {
    console.error('[brand:publishDraftAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard/brands/${brandSlug}`)
}

export async function discardDraftAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getTranslations('dashboard.edit.errors')
  const brandSlug = formData.get('brandSlug') as string
  if (!brandSlug) {
    return { error: 'Missing brand slug' }
  }

  try {
    const editor = await requireBrandEditor(brandSlug)
    if ('error' in editor) {
      if (editor.error === 'notLoggedIn') {
        return { error: t('notLoggedIn') }
      }
      if (editor.error === 'forbidden') {
        return { error: t('forbidden') }
      }
      return { error: `Brand not found: ${brandSlug}` }
    }
    const { user, brand, actingAdmin } = editor

    const { snapshot } = await discardDraft(brand.id)
    const draftOnlyImages = diffRemovedImageUrls(imageUrlsFromSnapshot(snapshot), imageUrlsFromBrand(brand))
    await deleteBrandImages(draftOnlyImages)
    await logAdminActionIfAdmin(actingAdmin, { id: user.id, email: user.email ?? null }, 'draft_discard', brandSlug, brand.id)

    revalidatePath(`/dashboard/brands/${brand.slug}/edit`)
  } catch (err) {
    console.error('[brand:discardDraftAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard/brands/${brandSlug}/edit`)
}
