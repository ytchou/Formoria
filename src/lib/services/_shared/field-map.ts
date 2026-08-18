import type { TablesInsert } from '@/lib/supabase/database.types'
import { deriveSubcategoriesEn } from '@/lib/services/subcategories'
import {
  PURCHASE_CHANNELS,
  type PurchaseChannelCamelField,
  type PurchaseChannelColumn,
} from '@/lib/brands/purchase-channels'

type PurchaseChannelInsertFields = {
  [Column in PurchaseChannelColumn]?: string | null
}
type BrandInsertRow = TablesInsert<'brands'> &
  PurchaseChannelInsertFields
type SubmissionInsertRow = TablesInsert<'brand_submissions'> & PurchaseChannelInsertFields

/**
 * The camelCase link fields both write boundaries accept. The purchase half is
 * derived from the channel registry so a new channel does not have to be
 * re-typed here (and in the two public input signatures below).
 */
export type CamelSocialPurchaseFields = {
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
} & { [Field in PurchaseChannelCamelField]?: string | null }

type FieldMap<Source extends object, Target extends object> = ReadonlyArray<
  readonly [keyof Source, keyof Target]
>

function copyMappedFields<Source extends object, Target extends object>(
  source: Source,
  target: Partial<Target>,
  fields: FieldMap<Source, Target>,
): void {
  for (const [from, to] of fields) {
    const value = source[from]
    if (value !== undefined) {
      target[to] = value as Target[typeof to]
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Submission JSON is stored in snake_case. Keep form-facing `categorySlug`
 * and `subcategories`/`subcategoriesEn` at the TypeScript boundary while
 * emitting only the migrated JSON keys. The expand trigger fills legacy
 * aliases for older readers; this writer must not add them itself.
 */
function toSubmissionVocabularyJson(value: unknown): unknown {
  if (!isRecord(value)) return value

  const result = { ...value }
  if (Object.hasOwn(result, 'categorySlug')) {
    result.category = result.categorySlug
    delete result.categorySlug
  }
  if (Object.hasOwn(result, 'subcategoriesEn')) {
    result.subcategories_en = result.subcategoriesEn
    delete result.subcategoriesEn
  }
  return result
}

const SOCIAL_PURCHASE_FIELD_MAP = [
  ['socialInstagram', 'social_instagram'],
  ['socialThreads', 'social_threads'],
  ['socialFacebook', 'social_facebook'],
  ...PURCHASE_CHANNELS.map((channel) => [channel.camel, channel.column] as const),
] as const satisfies FieldMap<
  CamelSocialPurchaseFields,
  BrandInsertRow & SubmissionInsertRow
>

const BRAND_FIELD_MAP = [
  ['romanizedName', 'romanized_name'],
  ['contactEmail', 'contact_email'],
  ['mitStory', 'mit_story'],
  ['city', 'city'],
  ['otherUrls', 'other_urls'],
] as const satisfies FieldMap<
  {
    romanizedName?: string | null
    contactEmail?: string | null
    mitStory?: string | null
    city?: string | null
    otherUrls?: unknown
    priceRange?: number | null
    subcategories?: string[] | null
  },
  BrandInsertRow
>

const SUBMISSION_FIELD_MAP = [
  ['brandId', 'brand_id'],
  ['brandName', 'brand_name'],
  ['romanizedName', 'romanized_name'],
  ['submitterEmail', 'submitter_email'],
  ['submitterName', 'submitter_name'],
  ['description', 'description'],
  ['websiteUrl', 'website_url'],
  ['heroImageUrl', 'hero_image_url'],
  ['intent', 'intent'],
  ['otherUrls', 'other_urls'],
  ['suggestedSubcategories', 'suggested_tags'],
  ['status', 'status'],
  ['reviewerNotes', 'reviewer_notes'],
  ['pdpaConsentAt', 'pdpa_consent_at'],
  ['validationStatus', 'validation_status'],
  ['validationErrors', 'validation_errors'],
  ['notifiedAt', 'notified_at'],
  ['isBrandOwner', 'is_brand_owner'],
  ['sourceAttribution', 'source_attribution'],
] as const satisfies FieldMap<
  {
    brandId?: string | null
    brandName?: string
    romanizedName?: string | null
    submitterEmail?: string
    submitterName?: string | null
    description?: string | null
    websiteUrl?: string | null
    heroImageUrl?: string | null
    intent?: string
    otherUrls?: unknown
    suggestedSubcategories?: unknown
    status?: string
    reviewerNotes?: string | null
    pdpaConsentAt?: string | null
    validationStatus?: string | null
    validationErrors?: unknown
    notifiedAt?: string | null
    isBrandOwner?: boolean
    sourceAttribution?: string | null
    categoryNote?: string | null
  },
  SubmissionInsertRow
>

export function toBrandRow(input: CamelSocialPurchaseFields & {
  name?: string
  slug?: string
  romanizedName?: string | null
  description?: string | null
  descriptionEn?: string | null
  heroImageUrl?: string | null
  status?: string
  categorySlug?: string | null
  foundingYear?: number | null
  mitStory?: string | null
  city?: string | null
  otherUrls?: unknown
  contactEmail?: string | null
  priceRange?: number | null
  subcategories?: string[] | null
  subcategoriesEn?: string[] | null
  blurb?: string | null
  blurbEn?: string | null
  isDemo?: boolean
}): BrandInsertRow {
  const row: Partial<BrandInsertRow> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.slug !== undefined) row.slug = input.slug
  if (input.description !== undefined) row.description = input.description
  if (input.descriptionEn !== undefined) row.description_en = input.descriptionEn
  if (input.blurb !== undefined) (row as Record<string, unknown>).blurb = input.blurb
  if (input.blurbEn !== undefined) row.blurb_en = input.blurbEn
  if (input.heroImageUrl !== undefined) row.hero_image_url = input.heroImageUrl
  if (input.status !== undefined) row.status = input.status
  if (input.categorySlug !== undefined) row.category = input.categorySlug
  if (input.foundingYear !== undefined) row.founding_year = input.foundingYear
  copyMappedFields(input, row, SOCIAL_PURCHASE_FIELD_MAP)
  copyMappedFields(input, row, BRAND_FIELD_MAP)
  row.price_range = input.priceRange ?? null
  row.subcategories = input.subcategories ?? []
  // Single normalizer at the write boundary: `subcategories_en` is always a
  // function of `subcategories`, never a caller-supplied string. The admin
  // review action validates EN tags only for length, so without this an
  // unnormalized array reaches the DB and re-opens DEV-1266.
  if (input.subcategoriesEn !== undefined || input.subcategories !== undefined) {
    row.subcategories_en = deriveSubcategoriesEn(
      input.subcategories ?? [],
      input.subcategoriesEn ?? [],
    )
  }
  if (input.isDemo) row.is_demo = input.isDemo
  return row as BrandInsertRow
}

export function toSubmissionRow(input: CamelSocialPurchaseFields & {
  brandId?: string | null
  brandName?: string
  romanizedName?: string | null
  submitterEmail?: string
  submitterName?: string | null
  description?: string | null
  websiteUrl?: string | null
  heroImageUrl?: string | null
  intent?: string
  city?: string | null
  otherUrls?: unknown
  suggestedSubcategories?: unknown
  status?: string
  reviewerNotes?: string | null
  pdpaConsentAt?: string | null
  validationStatus?: string | null
  validationErrors?: unknown
  notifiedAt?: string | null
  isBrandOwner?: boolean
  sourceAttribution?: string | null
  categoryNote?: string | null
}): SubmissionInsertRow {
  const row: Partial<SubmissionInsertRow> = {}
  copyMappedFields(input, row, SUBMISSION_FIELD_MAP)
  copyMappedFields(input, row, SOCIAL_PURCHASE_FIELD_MAP)
  if (input.suggestedSubcategories !== undefined) {
    row.suggested_tags = toSubmissionVocabularyJson(
      input.suggestedSubcategories,
    ) as SubmissionInsertRow['suggested_tags']
  }
  row.category_note = input.categoryNote ?? null
  return row as SubmissionInsertRow
}
