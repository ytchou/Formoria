'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { isOwnerOf } from '@/lib/services/brand-owners'
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
import { checkContent, createModerationFlags } from '@/lib/services/moderation'
import type { Brand, PurchaseLink, RetailLocation } from '@/lib/types'

type ActionState = {
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
): { updateData: Partial<Brand>; fieldsToCheck: Record<string, string> } {
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

  // Build fields to check for moderation
  const fieldsToCheck: Record<string, string> = {}
  if (name) fieldsToCheck.name = name
  if (description) fieldsToCheck.description = description
  if (websiteUrl) fieldsToCheck.websiteUrl = websiteUrl
  if (instagram) fieldsToCheck.instagram = instagram
  if (threads) fieldsToCheck.threads = threads
  if (facebook) fieldsToCheck.facebook = facebook
  if (brandHighlights) fieldsToCheck.brandHighlights = brandHighlights

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

  return { updateData, fieldsToCheck }
}

function moderationFieldErrors(moderation: ReturnType<typeof checkContent>): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const blocked of moderation.blocked) {
    fieldErrors[blocked.field] = blocked.reason
  }
  return fieldErrors
}

async function createFlagsForModeration(
  moderation: ReturnType<typeof checkContent>,
  brand: Brand,
  userId: string,
  actingAdmin: boolean
): Promise<void> {
  if (moderation.flagged.length === 0) {
    return
  }

  function getPreviousContent(fieldName: string): string | null {
    switch (fieldName) {
      case 'name': return brand.name ?? null
      case 'description': return brand.description ?? null
      case 'websiteUrl': return brand.socialLinks.officialWebsite ?? null
      case 'instagram': return brand.socialLinks.instagram ?? null
      case 'threads': return brand.socialLinks.threads ?? null
      case 'facebook': return brand.socialLinks.facebook ?? null
      case 'brandHighlights': return brand.brandHighlights ?? null
      default: return null
    }
  }

  const flagInputs = moderation.flagged.map((flag) => ({
    brandId: brand.id,
    userId,
    fieldName: flag.field,
    flaggedContent: flag.content,
    flagReason: actingAdmin ? `admin-edit: ${flag.reason}` : flag.reason,
    tier: flag.tier,
    status: actingAdmin ? 'reviewed' as const : 'pending' as const,
    ...(actingAdmin ? { reviewedAt: new Date().toISOString() } : {}),
    previousContent: getPreviousContent(flag.field),
  }))

  await createModerationFlags(flagInputs)
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

function fieldsToCheckFromSnapshot(snapshot: Record<string, unknown>): Record<string, string> {
  const fieldsToCheck: Record<string, string> = {}
  if (typeof snapshot.name === 'string' && snapshot.name) fieldsToCheck.name = snapshot.name
  if (typeof snapshot.description === 'string' && snapshot.description) {
    fieldsToCheck.description = snapshot.description
  }
  if (typeof snapshot.brandHighlights === 'string' && snapshot.brandHighlights) {
    fieldsToCheck.brandHighlights = snapshot.brandHighlights
  }

  const socialLinks = snapshot.socialLinks
  if (typeof socialLinks === 'object' && socialLinks !== null && !Array.isArray(socialLinks)) {
    const links = socialLinks as Record<string, unknown>
    if (typeof links.officialWebsite === 'string' && links.officialWebsite) {
      fieldsToCheck.websiteUrl = links.officialWebsite
    }
    if (typeof links.instagram === 'string' && links.instagram) {
      fieldsToCheck.instagram = links.instagram
    }
    if (typeof links.threads === 'string' && links.threads) {
      fieldsToCheck.threads = links.threads
    }
    if (typeof links.facebook === 'string' && links.facebook) {
      fieldsToCheck.facebook = links.facebook
    }
  }

  return fieldsToCheck
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

    const { updateData, fieldsToCheck } = parseBrandEditForm(formData, brand)

    // Run moderation
    const moderation = checkContent(fieldsToCheck)

    if (moderation.isBlocked) {
      return { fieldErrors: moderationFieldErrors(moderation) }
    }

    const previousImageUrls = imageUrlsFromBrand(brand)
    const nextImageUrls = imageUrlsFromBrand({ ...brand, ...updateData })
    const orphans = diffRemovedImageUrls(previousImageUrls, nextImageUrls)

    const updatedBrand = await updateBrand(brand.id, updateData)
    await deleteBrandImages(orphans)

    // Record flags for Tier 2 content
    await createFlagsForModeration(moderation, brand, user.id, actingAdmin)

    const { snapshot } = await discardDraft(brand.id)
    const draftOnlyImages = diffRemovedImageUrls(
      imageUrlsFromSnapshot(snapshot),
      imageUrlsFromBrand(updatedBrand)
    )
    await deleteBrandImages(draftOnlyImages)

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath(`/dashboard/brands/${brandSlug}`)
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

    const { updateData, fieldsToCheck } = parseBrandEditForm(formData, brand)
    const moderation = checkContent(fieldsToCheck)

    if (moderation.isBlocked) {
      return { fieldErrors: moderationFieldErrors(moderation) }
    }

    await saveDraft(brand.id, updateData)
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

    const moderation = checkContent(fieldsToCheckFromSnapshot(snapshot))

    if (moderation.isBlocked) {
      return { fieldErrors: moderationFieldErrors(moderation) }
    }

    await createFlagsForModeration(moderation, brand, user.id, actingAdmin)

    const orphans = diffRemovedImageUrls(imageUrlsFromBrand(brand), imageUrlsFromSnapshot(snapshot))
    await publishDraft(brand.id)
    await deleteBrandImages(orphans)

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath(`/dashboard/brands/${brand.slug}`)
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
