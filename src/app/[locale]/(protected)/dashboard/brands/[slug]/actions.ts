'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { createPendingEdit } from '@/lib/services/pending-edits'
import { scanContent, shouldAutoApprove, saveModerationFlags } from '@/lib/services/moderation'
import {
  diffRemovedImageUrls,
  discardDraft,
  getBrandBySlug,
  getBrandDraft,
  publishDraft,
  saveDraft,
  updateBrand,
} from '@/lib/services/brands'
import { deleteBrandImages } from '@/lib/services/image-upload'
import type { Brand, PurchaseLink, RetailLocation } from '@/lib/types'
import type { ContentPayload, ModerationResult } from '@/lib/services/moderation'

type ActionState = {
  success?: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

const BRAND_HIGHLIGHTS_MAX_LENGTH = 300

class InvalidBrandEditFormError extends Error {}

function parseArrayField<T extends Record<string, string>>(
  formData: FormData,
  fieldName: string,
  keys: (keyof T)[]
): T[] {
  const results: T[] = []
  let index = 0
  while (true) {
    const firstKey = String(keys[0])
    const value = formData.get(`${fieldName}[${index}].${firstKey}`)
    if (value === null) break
    const item = {} as T
    for (const key of keys) {
      item[key] = (formData.get(`${fieldName}[${index}].${String(key)}`) ?? '') as T[typeof key]
    }
    results.push(item)
    index++
  }
  return results
}

function parseOptionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function parseBrandEditForm(
  formData: FormData,
  brand: Brand
): Partial<Brand> {
  // Extract basic fields
  const name = formData.get('name') as string | null
  const description = formData.get('description') as string | null
  const websiteUrl = formData.get('websiteUrl') as string | null
  const instagram = formData.get('instagram') as string | null
  const threads = formData.get('threads') as string | null
  const facebook = formData.get('facebook') as string | null
  const logoUrl = parseOptionalString(formData.get('logoUrl'))
  const heroImageUrl = parseOptionalString(formData.get('heroImageUrl'))
  const brandHighlightsRaw = parseOptionalString(formData.get('brandHighlights'))
  const brandHighlights = brandHighlightsRaw?.slice(0, BRAND_HIGHLIGHTS_MAX_LENGTH) ?? null

  // Extract new fields
  const foundingYearRaw = formData.get('foundingYear') as string | null
  const foundingYear = foundingYearRaw ? parseInt(foundingYearRaw, 10) : null
  let productPhotos: string[] = []

  try {
    const productPhotosRaw = formData.get('productPhotos')
    if (productPhotosRaw !== null) {
      const parsed = JSON.parse(String(productPhotosRaw))
      if (!Array.isArray(parsed)) {
        throw new InvalidBrandEditFormError('Invalid productPhotos payload')
      }
      productPhotos = parsed
        .filter((value): value is string => typeof value === 'string')
        .slice(0, 6)
    }
  } catch (error) {
    if (error instanceof InvalidBrandEditFormError) {
      throw error
    }
    throw new InvalidBrandEditFormError('Invalid productPhotos payload')
  }

  // Parse array fields
  const purchaseLinks = parseArrayField<{ platform: string; url: string; label: string }>(
    formData,
    'purchaseLinks',
    ['platform', 'url', 'label']
  )
  const retailLocations = parseArrayField<{ name: string; address: string }>(
    formData,
    'retailLocations',
    ['name', 'address']
  )

  // Security-relevant allow-list: only explicitly permitted owner-editable fields may reach updateBrand.
  const updateData: Partial<Brand> = {}
  if (name) updateData.name = name
  if (description !== null) updateData.description = description
  if (foundingYear !== null && !isNaN(foundingYear)) updateData.foundingYear = foundingYear
  if (purchaseLinks.length > 0) {
    updateData.purchaseLinks = purchaseLinks as PurchaseLink[]
  }
  if (retailLocations.length > 0) {
    updateData.retailLocations = retailLocations as RetailLocation[]
  }
  if (websiteUrl !== null || instagram !== null || threads !== null || facebook !== null) {
    updateData.socialLinks = {
      ...brand.socialLinks,
      ...(websiteUrl !== null ? { officialWebsite: websiteUrl || undefined } : {}),
      ...(instagram !== null ? { instagram: instagram || undefined } : {}),
      ...(threads !== null ? { threads: threads || undefined } : {}),
      ...(facebook !== null ? { facebook: facebook || undefined } : {}),
    }
  }
  if (formData.has('logoUrl')) updateData.logoUrl = logoUrl
  if (formData.has('heroImageUrl')) updateData.heroImageUrl = heroImageUrl
  if (formData.has('productPhotos')) updateData.productPhotos = productPhotos
  if (formData.has('brandHighlights')) updateData.brandHighlights = brandHighlights

  return updateData
}

function imageUrlsFromBrand(brand: Pick<Brand, 'logoUrl' | 'heroImageUrl' | 'productPhotos'>): string[] {
  return [
    brand.logoUrl,
    brand.heroImageUrl,
    ...(brand.productPhotos ?? []),
  ].filter((url): url is string => Boolean(url))
}

function imageUrlsFromSnapshot(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) {
    return []
  }

  return [
    typeof snapshot.logoUrl === 'string' ? snapshot.logoUrl : null,
    typeof snapshot.heroImageUrl === 'string' ? snapshot.heroImageUrl : null,
    ...(Array.isArray(snapshot.productPhotos)
      ? snapshot.productPhotos.filter((url): url is string => typeof url === 'string')
      : []),
  ].filter((url): url is string => Boolean(url))
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getPurchaseUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const firstLink = value.find((item): item is { url: string } => (
    typeof item === 'object' &&
    item !== null &&
    'url' in item &&
    typeof item.url === 'string' &&
    item.url.length > 0
  ))
  return firstLink?.url
}

function getWebsite(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('officialWebsite' in value)) {
    return undefined
  }

  return getString(value.officialWebsite)
}

function buildModerationPayload(
  proposedData: Record<string, unknown>,
  brandName: string
): ContentPayload {
  const proposedName = getString(proposedData.name)

  return {
    brandName: proposedName ?? brandName,
    fields: {
      name: proposedName,
      description: getString(proposedData.description),
      brandHighlights: getString(proposedData.brandHighlights),
      website: getWebsite(proposedData.socialLinks),
      purchaseUrl: getPurchaseUrl(proposedData.purchaseLinks),
    },
  }
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

async function applyBrandUpdate(
  brand: Brand,
  updateData: Partial<Brand>
): Promise<void> {
  const previousImageUrls = imageUrlsFromBrand(brand)
  const nextImageUrls = imageUrlsFromBrand({ ...brand, ...updateData })
  const orphans = diffRemovedImageUrls(previousImageUrls, nextImageUrls)

  const updatedBrand = await updateBrand(brand.id, updateData)

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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: t('notLoggedIn') }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)
    const actingAdmin = !owner && (await isActingAsAdmin(user.email))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

    const updateData = parseBrandEditForm(formData, brand)
    const proposedData = updateData as Record<string, unknown>
    const moderationResult = scanContent(buildModerationPayload(proposedData, brand.name))
    if (moderationResult.riskLevel === 'high') {
      return { error: t('unknown') }
    }

    const isAdmin = await isActingAsAdmin(user.email)
    if (!isAdmin) {
      const autoApprove = moderationResult.flags.length === 0
        ? await shouldAutoApprove(moderationResult, user.id)
        : false

      if (autoApprove) {
        await applyBrandUpdate(brand, updateData)
        redirect(`/dashboard?tab=${brandSlug}`)
      }

      await createPendingEdit(brand.id, user.id, updateData as Record<string, unknown>)
      await saveModerationFlagsQuietly(brand.id, user.id, moderationResult)
      return { success: true, message: 'brandEditSubmittedForReview' }
    }

    await applyBrandUpdate(brand, updateData)
  } catch (err) {
    if (err instanceof InvalidBrandEditFormError) {
      return { error: err.message }
    }

    console.error('[brand:updateBrandAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard?tab=${brandSlug}`)
}

export async function saveDraftAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const t = await getTranslations('dashboard.edit.errors')
  const brandSlug = formData.get('brandSlug') as string
  if (!brandSlug) {
    return { error: 'Missing brand slug' }
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: t('notLoggedIn') }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)
    const actingAdmin = !owner && (await isActingAsAdmin(user.email))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

    const updateData = parseBrandEditForm(formData, brand)

    await saveDraft(brand.id, updateData)
    revalidatePath(`/dashboard/brands/${brandSlug}/edit`)
    return {}
  } catch (err) {
    if (err instanceof InvalidBrandEditFormError) {
      return { error: err.message }
    }

    console.error('[brand:saveDraftAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }
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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: t('notLoggedIn') }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)
    const actingAdmin = !owner && (await isActingAsAdmin(user.email))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

    const snapshot = await getBrandDraft(brand.id)
    if (!snapshot) {
      return { error: t('noDraft') }
    }

    const draftPartial = snapshot
    const moderationResult = scanContent(buildModerationPayload(draftPartial, brand.name))
    if (moderationResult.riskLevel === 'high') {
      return { error: t('unknown') }
    }

    const isAdmin = await isActingAsAdmin(user.email)
    if (!isAdmin) {
      const autoApprove = moderationResult.flags.length === 0
        ? await shouldAutoApprove(moderationResult, user.id)
        : false

      if (autoApprove) {
        const nextImageUrls = imageUrlsFromBrand({
          logoUrl: 'logoUrl' in snapshot
            ? (typeof snapshot.logoUrl === 'string' ? snapshot.logoUrl : null)
            : brand.logoUrl,
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
        await deleteBrandImages(orphans)

        revalidatePath('/[locale]/brands/[slug]', 'page')
        revalidatePath('/dashboard')
        redirect(`/dashboard?tab=${brandSlug}`)
      }

      await createPendingEdit(brand.id, user.id, draftPartial)
      await saveModerationFlagsQuietly(brand.id, user.id, moderationResult)
      await discardDraft(brand.id)
      return { success: true, message: 'brandEditSubmittedForReview' }
    }

    const nextImageUrls = imageUrlsFromBrand({
      logoUrl: 'logoUrl' in snapshot
        ? (typeof snapshot.logoUrl === 'string' ? snapshot.logoUrl : null)
        : brand.logoUrl,
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
    await deleteBrandImages(orphans)

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath('/dashboard')
  } catch (err) {
    console.error('[brand:publishDraftAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard?tab=${brandSlug}`)
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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: t('notLoggedIn') }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)
    const actingAdmin = !owner && (await isActingAsAdmin(user.email))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

    const { snapshot } = await discardDraft(brand.id)
    const draftOnlyImages = diffRemovedImageUrls(imageUrlsFromSnapshot(snapshot), imageUrlsFromBrand(brand))
    await deleteBrandImages(draftOnlyImages)

    revalidatePath(`/dashboard/brands/${brand.slug}/edit`)
  } catch (err) {
    console.error('[brand:discardDraftAction]', err)
    return {
      error: err instanceof Error ? err.message : t('unknown'),
    }
  }

  redirect(`/dashboard/brands/${brandSlug}/edit`)
}
