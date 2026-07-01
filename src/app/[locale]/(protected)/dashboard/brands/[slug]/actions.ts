'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { getImpersonatedBrandSlug } from '@/lib/auth/impersonation'
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
import { logAdminActionIfAdmin } from '@/lib/services/admin-audit'
import {
  isOnboardingStepKey,
  setBrandOnboardingStepStatus,
} from '@/lib/services/brand-onboarding'
import type { Brand, CustomerVoice, OtherUrl, RetailLocation } from '@/lib/types'
import type { ContentPayload, ModerationResult } from '@/lib/services/moderation'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

type ActionState = {
  success?: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

class InvalidBrandEditFormError extends Error {}

function parseArrayField<T extends Record<string, string | undefined>>(
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

function parseProductTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') {
    return []
  }

  const tags = value
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

  const uniqueTags = tags.filter(
    (tag, index) => tags.findIndex(
      (candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()
    ) === index
  )

  if (uniqueTags.length > 5 || uniqueTags.some((tag) => tag.length > 40)) {
    throw new InvalidBrandEditFormError('Product tags must contain at most 5 tags of 40 characters or fewer')
  }

  return uniqueTags
}

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
  revalidatePath('/dashboard/onboarding')
}

async function hasMatchingImpersonation(brandSlug: string): Promise<boolean> {
  return (await getImpersonatedBrandSlug()) === brandSlug
}

function parseBrandEditForm(
  formData: FormData
): Partial<Brand> {
  // Extract basic fields
  const name = formData.get('name') as string | null
  const description = formData.get('description') as string | null
  const instagram = formData.get('socialInstagram') as string | null
  const threads = formData.get('socialThreads') as string | null
  const facebook = formData.get('socialFacebook') as string | null
  const heroImageUrl = parseOptionalString(formData.get('heroImageUrl'))
  const productType = parseOptionalString(formData.get('productType'))

  if (
    productType !== null &&
    !PRODUCT_TYPE_CATEGORIES.some((category) => category.slug === productType)
  ) {
    throw new InvalidBrandEditFormError('Invalid product type')
  }

  // Extract new fields
  const foundingYearRaw = formData.get('foundingYear') as string | null
  const foundingYear = foundingYearRaw ? parseInt(foundingYearRaw, 10) : null
  const priceRangeRaw = formData.get('priceRange') as string | null
  const priceRange = priceRangeRaw ? parseInt(priceRangeRaw, 10) : null
  const productTags = parseProductTags(formData.get('productTags'))
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

  // Parse purchase URL fields
  const purchaseWebsite = parseOptionalString(formData.get('purchaseWebsite'))
  const purchasePinkoi = parseOptionalString(formData.get('purchasePinkoi'))
  const purchaseShopee = parseOptionalString(formData.get('purchaseShopee'))
  const hasOtherUrls = formData.has('otherUrls[0].label') || formData.has('otherUrls[0].url')
  const otherUrls = parseArrayField<OtherUrl>(formData, 'otherUrls', ['label', 'url'])
  const hasCustomerVoices =
    formData.has('customerVoices[0].author') || formData.has('customerVoices[0].content')
  const customerVoices = parseArrayField<CustomerVoice>(
    formData,
    'customerVoices',
    ['author', 'content', 'source']
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
  if (formData.has('productType')) updateData.productType = productType
  if (foundingYear !== null && !isNaN(foundingYear)) updateData.foundingYear = foundingYear
  if (formData.has('purchaseWebsite')) updateData.purchaseWebsite = purchaseWebsite
  if (formData.has('purchasePinkoi')) updateData.purchasePinkoi = purchasePinkoi
  if (formData.has('purchaseShopee')) updateData.purchaseShopee = purchaseShopee
  if (hasOtherUrls) {
    updateData.otherUrls = otherUrls
  }
  if (hasCustomerVoices) {
    updateData.customerVoices = customerVoices
  }
  if (retailLocations.length > 0) {
    updateData.retailLocations = retailLocations as RetailLocation[]
  }
  if (instagram !== null) updateData.socialInstagram = instagram || null
  if (threads !== null) updateData.socialThreads = threads || null
  if (facebook !== null) updateData.socialFacebook = facebook || null
  if (formData.has('heroImageUrl')) updateData.heroImageUrl = heroImageUrl
  if (formData.has('productPhotos')) updateData.productPhotos = productPhotos
  if (formData.has('priceRange')) {
    updateData.priceRange = priceRange !== null && !isNaN(priceRange) ? priceRange : null
  }
  if (formData.has('productTags')) updateData.productTags = productTags

  return updateData
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

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function buildModerationPayload(
  proposedData: Record<string, unknown>,
  brandName: string
): ContentPayload {
  const proposedName = getString(proposedData.name)
  const productTags = Array.isArray(proposedData.productTags)
    ? proposedData.productTags.filter((tag): tag is string => typeof tag === 'string').join(' ')
    : undefined

  return {
    brandName: proposedName ?? brandName,
    fields: {
      name: proposedName,
      description: getString(proposedData.description),
      customerVoices: proposedData.customerVoices ? JSON.stringify(proposedData.customerVoices) : undefined,
      productTags,
      website: getString(proposedData.purchaseWebsite),
      purchaseUrl: getString(proposedData.purchasePinkoi) ?? getString(proposedData.purchaseShopee),
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
    const configuredAdmin = await isActingAsAdmin(user.email)
    const actingAdmin = !owner && configuredAdmin && (await hasMatchingImpersonation(brandSlug))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

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
        await applyBrandUpdate(brand, updateData)
        await completeOnboardingAfterOwnerSubmit(formData, brand.id, user.id, owner)
      } else {
        await createPendingEdit(brand.id, user.id, updateData as Record<string, unknown>)
        await saveModerationFlagsQuietly(brand.id, user.id, moderationResult)
        await completeOnboardingAfterOwnerSubmit(formData, brand.id, user.id, owner)
        return { success: true, message: 'brandEditSubmittedForReview' }
      }
    }

    await applyBrandUpdate(brand, updateData)
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

  redirect(`/dashboard?brand=${brandSlug}`)
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
    const configuredAdmin = await isActingAsAdmin(user.email)
    const actingAdmin = !owner && configuredAdmin && (await hasMatchingImpersonation(brandSlug))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

    const updateData = parseBrandEditForm(formData)

    await saveDraft(brand.id, updateData)
    await logAdminActionIfAdmin(actingAdmin, { id: user.id, email: user.email ?? null }, 'draft_save', brandSlug, brand.id)

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
    const configuredAdmin = await isActingAsAdmin(user.email)
    const actingAdmin = !owner && configuredAdmin && (await hasMatchingImpersonation(brandSlug))

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

  redirect(`/dashboard?brand=${brandSlug}`)
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
    const configuredAdmin = await isActingAsAdmin(user.email)
    const actingAdmin = !owner && configuredAdmin && (await hasMatchingImpersonation(brandSlug))

    if (!owner && !actingAdmin) {
      return { error: t('forbidden') }
    }

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
