import type { Brand, OtherUrl, RetailLocation } from '@/lib/types'
import type { ReputationSummary } from '@/lib/types/brand'
import type { ContentPayload } from '@/lib/services/moderation'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import {
  getDuplicateRetailLocationIndex,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import { sanitizeHref } from '@/lib/url'
import { deriveProductTagsEn } from '@/lib/services/product-tags'

export class InvalidBrandEditFormError extends Error {}

function parseArrayField<T extends Record<string, string | undefined>>(
  formData: FormData,
  fieldName: string,
  keys: (keyof T)[],
): T[] {
  const results: T[] = []
  let index = 0
  while (true) {
    const firstKey = String(keys[0])
    const value = formData.get(`${fieldName}[${index}].${firstKey}`)
    if (value === null) break
    const item = {} as T
    for (const key of keys) {
      item[key] = (formData.get(`${fieldName}[${index}].${String(key)}`) ??
        '') as T[typeof key]
    }
    results.push(item)
    index++
  }
  return results
}

function parseOptionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

type ProvenanceSourceForm = {
  url: string
}

type RetailLocationForm = {
  name: string
  relationshipType: string
  type: string
  address: string
  city: string
  district: string
  venueName: string
  floorOrCounter: string
  availabilityNote: string
  latitude: string
  longitude: string
  verificationStatus: string
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
    (tag, index) =>
      tags.findIndex(
        (candidate) =>
          candidate.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      ) === index,
  )

  if (uniqueTags.length > 5 || uniqueTags.some((tag) => tag.length > 40)) {
    throw new InvalidBrandEditFormError(
      'Product tags must contain at most 5 tags of 40 characters or fewer',
    )
  }

  return uniqueTags
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parseBrandEditForm(formData: FormData): Partial<Brand> {
  // Extract basic fields
  const name = formData.get('name') as string | null
  const description = formData.get('description') as string | null
  const instagram = formData.get('socialInstagram') as string | null
  const threads = formData.get('socialThreads') as string | null
  const facebook = formData.get('socialFacebook') as string | null
  const heroImageUrl = parseOptionalString(formData.get('heroImageUrl'))
  const productType = parseOptionalString(formData.get('productType'))
  const city = parseOptionalString(formData.get('city'))

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
  const reputationSummaryText = parseOptionalString(
    formData.get('reputationSummary'),
  )
  const mitStory = parseOptionalString(formData.get('mitStory'))
  const reputationSources = parseArrayField<ProvenanceSourceForm>(
    formData,
    'reputationSources',
    ['url'],
  )
  const hasOtherUrls =
    formData.has('otherUrls[0].label') || formData.has('otherUrls[0].url')
  const otherUrls = parseArrayField<OtherUrl>(formData, 'otherUrls', [
    'label',
    'url',
  ])
  const retailLocations = normalizeRetailLocations(
    parseArrayField<RetailLocationForm>(formData, 'retailLocations', [
      'name',
      'relationshipType',
      'type',
      'address',
      'city',
      'district',
      'venueName',
      'floorOrCounter',
      'availabilityNote',
      'latitude',
      'longitude',
      'verificationStatus',
    ]),
  )
  const hasRetailLocationsField = formData.has('retailLocations[0].name')
  const duplicateRetailLocationIndex =
    getDuplicateRetailLocationIndex(retailLocations)
  if (duplicateRetailLocationIndex !== undefined) {
    throw new InvalidBrandEditFormError('Duplicate retail location')
  }

  // Security-relevant allow-list: only explicitly permitted owner-editable fields may reach updateBrand.
  const updateData: Partial<Brand> = {}
  if (name) updateData.name = name
  if (description !== null) updateData.description = description
  if (formData.has('productType')) updateData.productType = productType
  if (formData.has('city')) updateData.city = city
  if (foundingYear !== null && !isNaN(foundingYear))
    updateData.foundingYear = foundingYear
  if (formData.has('purchaseWebsite'))
    updateData.purchaseWebsite = purchaseWebsite
  if (formData.has('purchasePinkoi'))
    updateData.purchasePinkoi = sanitizeHref(purchasePinkoi) ?? null
  if (formData.has('purchaseShopee'))
    updateData.purchaseShopee = sanitizeHref(purchaseShopee) ?? null
  if (hasOtherUrls) {
    updateData.otherUrls = otherUrls.map((entry) => ({
      ...entry,
      url: sanitizeHref(entry.url) ?? '',
    }))
  }
  if (hasRetailLocationsField) {
    updateData.retailLocations = retailLocations as RetailLocation[]
  }
  if (instagram !== null) updateData.socialInstagram = instagram || null
  if (threads !== null) updateData.socialThreads = threads || null
  if (facebook !== null)
    updateData.socialFacebook = sanitizeHref(facebook) ?? null
  if (formData.has('heroImageUrl')) updateData.heroImageUrl = heroImageUrl
  if (formData.has('productPhotos')) updateData.productPhotos = productPhotos
  if (formData.has('priceRange')) {
    updateData.priceRange =
      priceRange !== null && !isNaN(priceRange) ? priceRange : null
  }
  if (formData.has('productTags')) {
    updateData.productTags = productTags
    updateData.productTagsEn = deriveProductTagsEn(productTags)
  }
  if (formData.has('reputationSummary') || reputationSources.length > 0) {
    updateData.reputationSummary = {
      text: reputationSummaryText ?? '',
      sources: reputationSources.map((source) => ({
        url: sanitizeHref(source.url) ?? '',
      })),
    } satisfies ReputationSummary
  }
  if (formData.has('mitStory')) updateData.mitStory = mitStory

  return updateData
}

export function buildModerationPayload(
  proposedData: Record<string, unknown>,
  brandName: string,
): ContentPayload {
  const proposedName = getString(proposedData.name)
  const productTags = Array.isArray(proposedData.productTags)
    ? proposedData.productTags
        .filter((tag): tag is string => typeof tag === 'string')
        .join(' ')
    : undefined

  return {
    brandName: proposedName ?? brandName,
    fields: {
      name: proposedName,
      description: getString(proposedData.description),
      mitStory: getString(proposedData.mitStory),
      productTags,
      website: getString(proposedData.purchaseWebsite),
      purchaseUrl:
        getString(proposedData.purchasePinkoi) ??
        getString(proposedData.purchaseShopee),
    },
  }
}
