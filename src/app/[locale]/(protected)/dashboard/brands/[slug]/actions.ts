'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { getBrandBySlug, updateBrand } from '@/lib/services/brands'
import { deleteBrandImages, diffRemovedImageUrls } from '@/lib/services/image-upload'
import { checkContent, createModerationFlags } from '@/lib/services/moderation'
import type { PurchaseLink, RetailLocation } from '@/lib/types'

type ActionState = {
  error?: string
  fieldErrors?: Record<string, string>
} | undefined

const BRAND_HIGHLIGHTS_MAX_LENGTH = 300

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

export async function updateBrandAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
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
      return { error: '請先登入才能編輯品牌' }
    }

    const brand = await getBrandBySlug(brandSlug)
    const owner = await isOwnerOf(user.id, brand.id)

    if (!owner) {
      return { error: '您沒有權限編輯此品牌' }
    }

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
        if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
          return { error: 'Invalid productPhotos payload' }
        }
        productPhotos = parsed
      }
    } catch {
      return { error: 'Invalid productPhotos payload' }
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

    // Run moderation
    const moderation = checkContent(fieldsToCheck)

    if (moderation.isBlocked) {
      const fieldErrors: Record<string, string> = {}
      for (const blocked of moderation.blocked) {
        fieldErrors[blocked.field] = blocked.reason
      }
      return { fieldErrors }
    }

    const previousImageUrls = [
      brand.logoUrl,
      brand.heroImageUrl,
      ...(brand.productPhotos ?? []),
    ].filter((url): url is string => Boolean(url))
    const nextImageUrls = [logoUrl, heroImageUrl, ...productPhotos].filter(
      (url): url is string => Boolean(url)
    )
    const orphans = diffRemovedImageUrls(previousImageUrls, nextImageUrls)

    // Security-relevant allow-list: only explicitly permitted owner-editable fields may reach updateBrand.
    const updateData: Record<string, unknown> = {}
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

    await updateBrand(brand.id, updateData as Parameters<typeof updateBrand>[1])
    await deleteBrandImages(orphans)

    // Record flags for Tier 2 content
    if (moderation.flagged.length > 0) {
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
        userId: user.id,
        fieldName: flag.field,
        flaggedContent: flag.content,
        flagReason: flag.reason,
        tier: flag.tier,
        status: 'pending' as const,
        previousContent: getPreviousContent(flag.field),
      }))

      await createModerationFlags(flagInputs)
    }

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath(`/dashboard/brands/${brandSlug}`)
  } catch (err) {
    console.error('[brand:updateBrandAction]', err)
    return {
      error: err instanceof Error ? err.message : '發生預期外的錯誤，請再試一次。',
    }
  }

  redirect(`/dashboard/brands/${brandSlug}`)
}
