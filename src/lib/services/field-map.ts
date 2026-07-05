import type { TablesInsert } from '@/lib/supabase/database.types'

type BrandInsertRow = TablesInsert<'brands'>
type SubmissionInsertRow = TablesInsert<'brand_submissions'>

type CamelSocialPurchaseFields = {
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
}

type FieldMap<Source extends object, Target extends object> = ReadonlyArray<
  readonly [keyof Source, keyof Target]
>

function copyMappedFields<Source extends object, Target extends object>(
  source: Source,
  target: Partial<Target>,
  fields: FieldMap<Source, Target>
): void {
  for (const [from, to] of fields) {
    const value = source[from]
    if (value !== undefined) {
      target[to] = value as Target[typeof to]
    }
  }
}

const SOCIAL_PURCHASE_FIELD_MAP = [
  ['socialInstagram', 'social_instagram'],
  ['socialThreads', 'social_threads'],
  ['socialFacebook', 'social_facebook'],
  ['purchaseWebsite', 'purchase_website'],
  ['purchasePinkoi', 'purchase_pinkoi'],
  ['purchaseShopee', 'purchase_shopee'],
] as const satisfies FieldMap<CamelSocialPurchaseFields, BrandInsertRow & SubmissionInsertRow>

const BRAND_FIELD_MAP = [
  ['contactEmail', 'contact_email'],
  ['otherUrls', 'other_urls'],
  ['retailLocations', 'retail_locations'],
  ['customerVoices', 'customer_voices'],
  ['productPhotos', 'product_photos'],
] as const satisfies FieldMap<
  {
    contactEmail?: string | null
    mitStory?: string | null
    otherUrls?: unknown
    retailLocations?: unknown
    customerVoices?: unknown
    productPhotos?: unknown
    priceRange?: number | null
    productTags?: string[] | null
  },
  BrandInsertRow
>

const SUBMISSION_FIELD_MAP = [
  ['brandId', 'brand_id'],
  ['brandName', 'brand_name'],
  ['submitterEmail', 'submitter_email'],
  ['submitterName', 'submitter_name'],
  ['description', 'description'],
  ['websiteUrl', 'website_url'],
  ['heroImageUrl', 'hero_image_url'],
  ['productPhotos', 'product_photos'],
  ['otherUrls', 'other_urls'],
  ['suggestedTags', 'suggested_tags'],
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
    submitterEmail?: string
    submitterName?: string | null
    description?: string | null
    websiteUrl?: string | null
    heroImageUrl?: string | null
    productPhotos?: unknown
    otherUrls?: unknown
    suggestedTags?: unknown
    status?: string
    reviewerNotes?: string | null
    pdpaConsentAt?: string | null
    validationStatus?: string | null
    validationErrors?: unknown
    notifiedAt?: string | null
    isBrandOwner?: boolean
    sourceAttribution?: string | null
    productTypeNote?: string | null
  },
  SubmissionInsertRow
>

export function toBrandRow(input: {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  status?: string
  productType?: string | null
  category?: string | null
  foundingYear?: number | null
  mitStory?: string | null
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
  otherUrls?: unknown
  retailLocations?: unknown
  customerVoices?: unknown
  productPhotos?: unknown
  contactEmail?: string | null
  priceRange?: number | null
  productTags?: string[] | null
  isDemo?: boolean
}): BrandInsertRow {
  const row: Partial<BrandInsertRow> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.slug !== undefined) row.slug = input.slug
  if (input.description !== undefined) row.description = input.description
  if (input.heroImageUrl !== undefined) row.hero_image_url = input.heroImageUrl
  if (input.status !== undefined) row.status = input.status
  if (input.productType !== undefined) {
    row.product_type = input.productType
  } else if (input.category != null) {
    row.product_type = input.category
  }
  if (input.foundingYear !== undefined) row.founding_year = input.foundingYear
  if (input.mitStory !== undefined) row.mit_story = input.mitStory
  copyMappedFields(input, row, SOCIAL_PURCHASE_FIELD_MAP)
  copyMappedFields(input, row, BRAND_FIELD_MAP)
  row.price_range = input.priceRange ?? null
  row.product_tags = input.productTags ?? []
  if (input.isDemo) row.is_demo = input.isDemo
  return row as BrandInsertRow
}

export function toSubmissionRow(input: {
  brandId?: string | null
  brandName?: string
  submitterEmail?: string
  submitterName?: string | null
  description?: string | null
  websiteUrl?: string | null
  heroImageUrl?: string | null
  productPhotos?: unknown
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
  otherUrls?: unknown
  suggestedTags?: unknown
  status?: string
  reviewerNotes?: string | null
  pdpaConsentAt?: string | null
  validationStatus?: string | null
  validationErrors?: unknown
  notifiedAt?: string | null
  isBrandOwner?: boolean
  sourceAttribution?: string | null
  productTypeNote?: string | null
}): SubmissionInsertRow {
  const row: Partial<SubmissionInsertRow> = {}
  copyMappedFields(input, row, SUBMISSION_FIELD_MAP)
  copyMappedFields(input, row, SOCIAL_PURCHASE_FIELD_MAP)
  row.product_type_note = input.productTypeNote ?? null
  return row as SubmissionInsertRow
}
