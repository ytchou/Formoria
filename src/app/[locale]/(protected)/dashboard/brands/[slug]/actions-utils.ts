import type { Brand, CustomerVoice, OtherUrl, RetailLocation } from '@/lib/types'
import type {
  Certification,
  Manufacturing,
  Policies,
  ReputationSummary,
} from '@/lib/types/brand'
import type { ContentPayload } from '@/lib/services/moderation'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { sanitizeHref } from '@/lib/url'

export class InvalidBrandEditFormError extends Error {}

export function parseArrayField<T extends Record<string, string | undefined>>(
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

export function parseOptionalString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function parseOptionalBoolean(value: FormDataEntryValue | null): boolean | null {
  if (value === null) return null
  if (typeof value === 'string') return value === 'on' || value === 'true'
  return null
}

export type ProvenanceSourceForm = {
  url: string
  title: string
  retrievedAt: string
}

export function parseProductTags(value: FormDataEntryValue | null): string[] {
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

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parseBrandEditForm(
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
  const reputationSummaryText = parseOptionalString(formData.get('reputationSummary'))
  const mitStory = parseOptionalString(formData.get('mitStory'))
  const reputationSources = parseArrayField<ProvenanceSourceForm>(
    formData,
    'reputationSources',
    ['url', 'title', 'retrievedAt']
  )
  const factoryLocation = parseOptionalString(formData.get('factoryLocation'))
  const productionModel = parseOptionalString(formData.get('productionModel'))
  const manufacturingNotes = parseOptionalString(formData.get('manufacturingNotes'))
  const certifications = parseArrayField<{
    name: string
    issuer: string
    year: string
    sourceUrl: string
  }>(formData, 'certifications', ['name', 'issuer', 'year', 'sourceUrl'])
  const returnsPolicy = parseOptionalString(formData.get('returnsPolicy'))
  const warranty = parseOptionalString(formData.get('warranty'))
  const shipsInternational = parseOptionalBoolean(formData.get('shipsInternational'))
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
  if (formData.has('purchasePinkoi')) updateData.purchasePinkoi = sanitizeHref(purchasePinkoi) ?? null
  if (formData.has('purchaseShopee')) updateData.purchaseShopee = sanitizeHref(purchaseShopee) ?? null
  if (hasOtherUrls) {
    updateData.otherUrls = otherUrls.map((entry) => ({
      ...entry,
      url: sanitizeHref(entry.url) ?? '',
    }))
  }
  if (hasCustomerVoices) {
    updateData.customerVoices = customerVoices
  }
  if (retailLocations.length > 0) {
    updateData.retailLocations = retailLocations as RetailLocation[]
  }
  if (instagram !== null) updateData.socialInstagram = instagram || null
  if (threads !== null) updateData.socialThreads = threads || null
  if (facebook !== null) updateData.socialFacebook = sanitizeHref(facebook) ?? null
  if (formData.has('heroImageUrl')) updateData.heroImageUrl = heroImageUrl
  if (formData.has('productPhotos')) updateData.productPhotos = productPhotos
  if (formData.has('priceRange')) {
    updateData.priceRange = priceRange !== null && !isNaN(priceRange) ? priceRange : null
  }
  if (formData.has('productTags')) updateData.productTags = productTags
  if (formData.has('reputationSummary') || reputationSources.length > 0) {
    updateData.reputationSummary = {
      text: reputationSummaryText ?? '',
      sources: reputationSources.map((source) => ({
        url: sanitizeHref(source.url) ?? '',
        title: source.title,
        retrievedAt: source.retrievedAt,
      })),
      retrievedAt: reputationSources[0]?.retrievedAt ?? '',
    } satisfies ReputationSummary
  }
  if (formData.has('mitStory')) updateData.mitStory = mitStory
  if (
    formData.has('factoryLocation') ||
    formData.has('productionModel') ||
    formData.has('manufacturingNotes')
  ) {
    updateData.manufacturing = {
      factoryLocation,
      productionModel:
        productionModel === 'own' || productionModel === 'oem' || productionModel === 'mixed'
          ? productionModel
          : null,
      notes: manufacturingNotes,
      sources: [],
    } satisfies Manufacturing
  }
  if (formData.has('certifications[0].name')) {
    updateData.certifications = certifications
      .map((entry) => {
        const year = entry.year ? parseInt(entry.year, 10) : null
        const sourceUrl = sanitizeHref(entry.sourceUrl)
        if (!entry.name && !entry.issuer && !entry.year && !entry.sourceUrl) {
          return null
        }
        return {
          name: entry.name,
          issuer: entry.issuer || null,
          year: year !== null && !Number.isNaN(year) ? year : null,
          source: sourceUrl
            ? {
                url: sourceUrl,
                title: entry.name,
                retrievedAt: '',
              }
            : null,
        }
      })
      .filter((entry): entry is Certification => entry !== null)
  }
  if (formData.has('returnsPolicy') || formData.has('warranty') || formData.has('shipsInternational')) {
    updateData.policies = {
      returns: returnsPolicy,
      warranty,
      shipsInternational,
      sources: [],
    } satisfies Policies
  }

  return updateData
}

export function buildModerationPayload(
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
      mitStory: getString(proposedData.mitStory),
      customerVoices: proposedData.customerVoices ? JSON.stringify(proposedData.customerVoices) : undefined,
      productTags,
      website: getString(proposedData.purchaseWebsite),
      purchaseUrl: getString(proposedData.purchasePinkoi) ?? getString(proposedData.purchaseShopee),
    },
  }
}
