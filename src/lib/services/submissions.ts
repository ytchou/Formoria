import type { Brand, BrandSubmission, DenialReason, OtherUrl, SubmissionStatus, SourceAttribution } from '@/lib/types'
import type { DuplicateCheckResult } from '@/lib/types/submission'
import type { Database } from '@/lib/supabase/database.types'
import type { EnrichedData } from '@/lib/types/enriched-data'
import { enrichedDataFromDb } from '@/lib/types/enriched-data'
import { NotFoundError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateSlug, isReservedSlug } from '@/lib/services/brands'
import { toSubmissionRow } from './field-map'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type SubmissionRow = Database['public']['Tables']['brand_submissions']['Row']
type SubmissionRowWithProductTypeNote = SubmissionRow & {
  hero_image_url?: string | null
  product_photos?: unknown
  product_type_note?: string | null
  social_instagram?: string | null
  social_threads?: string | null
  social_facebook?: string | null
  purchase_website?: string | null
  purchase_pinkoi?: string | null
  purchase_shopee?: string | null
  other_urls?: OtherUrl[] | null
}
export type BrandSubmissionWithProductTypeNote = BrandSubmission & {
  websiteUrl: string | null
  productTypeNote: string | null
}
export type BrandSubmissionForReview = BrandSubmissionWithProductTypeNote & {
  enriched_data: EnrichedData | null
}

/**
 * Mapper input: the required core fields are mandatory; columns added in later
 * migrations (pdpa_consent_at, hero_image_url, source_attribution) are optional so that
 * unit test fixtures can omit them without casts.
 */
type SubmissionRowInput = Pick<
  SubmissionRowWithProductTypeNote,
  | 'id'
  | 'brand_id'
  | 'brand_name'
  | 'submitter_email'
  | 'submitted_at'
  | 'status'
> & {
  unified_business_number?: string | null
} & Partial<Omit<SubmissionRowWithProductTypeNote,
  | 'id'
  | 'brand_id'
  | 'brand_name'
  | 'submitter_email'
  | 'submitted_at'
  | 'status'
>>

type SuggestedTagsInput = string[] | { values?: string[] }
type ServiceClient = SupabaseClient<Database>
type BrandInsert = Database['public']['Tables']['brands']['Insert']

export type SubmissionApprovalOverrides = Partial<
  Pick<
    Brand,
    | 'description'
    | 'heroImageUrl'
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
    | 'otherUrls'
    | 'productPhotos'
  >
> & {
  name?: string | null
  productType?: string | null
  mitSmileCert?: string | null
}

export type ApproveSubmissionResult = {
  brandId: string
  submitterEmail: string
  brandName: string
  submitterName: string | null
  isBrandOwner: boolean
}

// ---------------------------------------------------------------------------
// Pure record builder (no DB calls — testable in isolation)
// ---------------------------------------------------------------------------

export type CreateSubmissionInput = {
  brandId?: string
  brandName: string
  submitterEmail: string
  submitterName?: string
  description?: string
  websiteUrl?: string
  heroImageUrl?: string
  productPhotos?: string[]
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
  otherUrls?: OtherUrl[]
  suggestedTags?: string[] | { values?: string[] }
  pdpaConsentAt?: string
  isOwner?: boolean
  sourceAttribution?: SourceAttribution | null
  productTypeNote?: string | null
}

export function buildSubmissionRecord(input: CreateSubmissionInput): Record<string, unknown> {
  return {
    brand_id: input.brandId ?? null,
    brand_name: input.brandName,
    submitter_email: input.submitterEmail,
    submitter_name: input.submitterName ?? null,
    description: input.description ?? null,
    website_url: input.websiteUrl ?? null,
    hero_image_url: input.heroImageUrl ?? null,
    product_photos: input.productPhotos ?? [],
    social_instagram: input.socialInstagram ?? null,
    social_threads: input.socialThreads ?? null,
    social_facebook: input.socialFacebook ?? null,
    purchase_website: input.purchaseWebsite ?? null,
    purchase_pinkoi: input.purchasePinkoi ?? null,
    purchase_shopee: input.purchaseShopee ?? null,
    other_urls: input.otherUrls ?? [],
    suggested_tags: input.suggestedTags ?? [],
    pdpa_consent_at: input.pdpaConsentAt ?? null,
    is_brand_owner: input.isOwner ?? false,
    source_attribution: input.sourceAttribution ?? null,
    product_type_note: input.productTypeNote ?? null,
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function submissionToDomain(row: SubmissionRowInput): BrandSubmissionWithProductTypeNote {
  return {
    id: row.id,
    brandId: row.brand_id ?? null,
    brandName: row.brand_name,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name ?? null,
    description: row.description ?? null,
    websiteUrl: row.website_url ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    productPhotos: Array.isArray(row.product_photos)
      ? row.product_photos.filter((url): url is string => typeof url === 'string')
      : [],
    socialInstagram: row.social_instagram ?? null,
    socialThreads: row.social_threads ?? null,
    socialFacebook: row.social_facebook ?? null,
    purchaseWebsite: row.purchase_website ?? null,
    purchasePinkoi: row.purchase_pinkoi ?? null,
    purchaseShopee: row.purchase_shopee ?? null,
    otherUrls: (row.other_urls as OtherUrl[]) ?? [],
    suggestedTags: (row.suggested_tags as string[]) ?? [],
    status: row.status as BrandSubmission['status'],
    reviewerNotes: row.reviewer_notes ?? null,
    denialReason: (row.denial_reason as DenialReason) ?? null,
    submittedAt: row.submitted_at ?? '',
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    pdpaConsentAt: row.pdpa_consent_at ?? null,
    validationStatus: (row.validation_status as BrandSubmission['validationStatus']) ?? null,
    validationErrors: (row.validation_errors as string[] | null) ?? null,
    notifiedAt: row.notified_at ?? null,
    isBrandOwner: row.is_brand_owner ?? false,
    sourceAttribution: (row.source_attribution as BrandSubmission['sourceAttribution']) ?? null,
    productTypeNote: row.product_type_note ?? null,
  }
}

export function submissionToInsert(
  data: Partial<Omit<BrandSubmission, 'suggestedTags'>> & {
    websiteUrl?: string | null
    suggestedTags?: SuggestedTagsInput
    productTypeNote?: string | null
  }
): Record<string, unknown> {
  return toSubmissionRow(data)
}

function isStructuredTags(v: unknown): v is { values?: string[]; productType?: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isEnrichedData(value: unknown): value is EnrichedData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeOtherUrls(value: unknown): OtherUrl[] {
  if (!Array.isArray(value)) return []

  return value
    .map((link) => {
      if (typeof link === 'string') {
        return { label: '', url: link.trim() }
      }

      if (link && typeof link === 'object') {
        const candidate = link as Partial<OtherUrl>
        return {
          label: normalizeString(candidate.label) ?? '',
          url: normalizeString(candidate.url) ?? '',
        }
      }

      return { label: '', url: '' }
    })
    .filter((link) => link.label || link.url)
}

function cleanRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

function submissionToBrandBase(row: SubmissionRow): BrandInsert {
  const rowWithSubmissionImages = row as SubmissionRow & {
    hero_image_url?: string | null
    product_photos?: unknown
  }

  return {
    name: row.brand_name,
    slug: generateSlug(row.brand_name),
    description: row.description,
    hero_image_url: rowWithSubmissionImages.hero_image_url ?? null,
    status: 'approved',
    is_demo: false,
    product_type: null as unknown as string,
    founding_year: null,
    social_instagram: row.social_instagram,
    social_threads: row.social_threads,
    social_facebook: row.social_facebook,
    purchase_website: row.purchase_website ?? row.website_url,
    purchase_pinkoi: row.purchase_pinkoi,
    purchase_shopee: row.purchase_shopee,
    other_urls: normalizeOtherUrls(row.other_urls),
    retail_locations: [],
    product_photos: Array.isArray(rowWithSubmissionImages.product_photos)
      ? rowWithSubmissionImages.product_photos.filter((url): url is string => typeof url === 'string')
      : [],
    contact_email: row.submitter_email,
    site_content: null,
    submitted_at: row.submitted_at,
    approved_at: new Date().toISOString(),
  }
}

function enrichedDataToBrandInsert(enrichedData: EnrichedData | null): Partial<BrandInsert> {
  if (!enrichedData) return {}

  return cleanRecord({
    name: normalizeString(enrichedData.name) ?? undefined,
    description: normalizeString(enrichedData.description) ?? undefined,
    hero_image_url: normalizeString(enrichedData.heroImageUrl) ?? undefined,
    product_photos: enrichedData.productPhotos,
    product_type: normalizeString(enrichedData.productType) ?? undefined,
    price_range: enrichedData.priceRange,
    product_tags: enrichedData.productTags,
    social_instagram: normalizeString(enrichedData.socialInstagram) ?? undefined,
    social_threads: normalizeString(enrichedData.socialThreads) ?? undefined,
    social_facebook: normalizeString(enrichedData.socialFacebook) ?? undefined,
    purchase_website: normalizeString(enrichedData.purchaseWebsite) ?? undefined,
    purchase_pinkoi: normalizeString(enrichedData.purchasePinkoi) ?? undefined,
    purchase_shopee: normalizeString(enrichedData.purchaseShopee) ?? undefined,
    other_urls: enrichedData.otherUrls ? normalizeOtherUrls(enrichedData.otherUrls) : undefined,
  })
}

function approvalOverridesToBrandInsert(
  overrides: SubmissionApprovalOverrides | undefined
): Partial<BrandInsert> {
  if (!overrides) return {}
  const productType = normalizeString(overrides.productType)

  return cleanRecord({
    name: normalizeString(overrides.name) ?? undefined,
    description: overrides.description === undefined ? undefined : normalizeString(overrides.description),
    hero_image_url: overrides.heroImageUrl === undefined ? undefined : normalizeString(overrides.heroImageUrl),
    product_type: productType ?? undefined,
    product_photos: overrides.productPhotos,
    social_instagram:
      overrides.socialInstagram === undefined ? undefined : normalizeString(overrides.socialInstagram),
    social_threads: overrides.socialThreads === undefined ? undefined : normalizeString(overrides.socialThreads),
    social_facebook:
      overrides.socialFacebook === undefined ? undefined : normalizeString(overrides.socialFacebook),
    purchase_website:
      overrides.purchaseWebsite === undefined ? undefined : normalizeString(overrides.purchaseWebsite),
    purchase_pinkoi: overrides.purchasePinkoi === undefined ? undefined : normalizeString(overrides.purchasePinkoi),
    purchase_shopee: overrides.purchaseShopee === undefined ? undefined : normalizeString(overrides.purchaseShopee),
    other_urls: overrides.otherUrls === undefined ? undefined : normalizeOtherUrls(overrides.otherUrls),
  })
}

async function resolveUniqueSlug(supabase: ServiceClient, slug: string): Promise<string> {
  let candidate = slug
  let suffix = 2

  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()

    if (error) throw error
    if (!data && !isReservedSlug(candidate)) return candidate

    candidate = `${slug}-${suffix}`
    suffix += 1
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createSubmission(
  data: Pick<BrandSubmission, 'brandName' | 'submitterEmail'> &
    Partial<Pick<BrandSubmission, 'brandId' | 'submitterName' | 'description' | 'heroImageUrl' | 'productPhotos' | 'socialInstagram' | 'socialThreads' | 'socialFacebook' | 'purchaseWebsite' | 'purchasePinkoi' | 'purchaseShopee' | 'otherUrls' | 'pdpaConsentAt' | 'isBrandOwner' | 'sourceAttribution'>> & {
      websiteUrl?: string | null
      suggestedTags?: SuggestedTagsInput
      productTypeNote?: string | null
    }
): Promise<BrandSubmissionWithProductTypeNote> {
  // Authenticated insert: RLS requires a signed-in user, and the submit action authenticates first.
  const supabase = await createClient()
  const row = submissionToInsert(data)
  const { data: inserted, error } = await supabase
    .from('brand_submissions')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return submissionToDomain(inserted)
}

const ADMIN_SUBMISSIONS_SELECT = `
  id,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  hero_image_url,
  product_photos,
  social_instagram,
  social_threads,
  social_facebook,
  purchase_website,
  purchase_pinkoi,
  purchase_shopee,
  other_urls,
  suggested_tags,
  status,
  reviewer_notes,
  submitted_at,
  reviewed_at,
  reviewed_by,
  pdpa_consent_at,
  validation_status,
  validation_errors,
  notified_at,
  is_brand_owner,
  source_attribution,
  product_type_note,
  enriched_data
`

const ADMIN_REVIEW_SUBMISSIONS_SELECT = `
  id,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  hero_image_url,
  product_photos,
  social_instagram,
  social_threads,
  social_facebook,
  purchase_website,
  purchase_pinkoi,
  purchase_shopee,
  other_urls,
  suggested_tags,
  status,
  reviewer_notes,
  submitted_at,
  reviewed_at,
  reviewed_by,
  pdpa_consent_at,
  validation_status,
  validation_errors,
  notified_at,
  is_brand_owner,
  source_attribution,
  product_type_note,
  enriched_data
`

export async function getAdminSubmissions(): Promise<BrandSubmissionWithProductTypeNote[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select(ADMIN_SUBMISSIONS_SELECT)
    .order('submitted_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as SubmissionRowWithProductTypeNote[]).map(submissionToDomain)
}

export async function getSubmissionsForReview(): Promise<BrandSubmissionForReview[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select(ADMIN_REVIEW_SUBMISSIONS_SELECT)
    .order('submitted_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as unknown as SubmissionRowWithProductTypeNote[]).map((row) => ({
    ...submissionToDomain(row as SubmissionRowWithProductTypeNote),
    enriched_data: isEnrichedData(row.enriched_data)
      ? enrichedDataFromDb(row.enriched_data as Record<string, unknown>)
      : null,
  }))
}

export async function getSubmission(id: string): Promise<BrandSubmission> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id, { cause: error })
  return submissionToDomain(data)
}

export async function getSubmissions(
  status?: SubmissionStatus,
  options?: { limit?: number }
): Promise<BrandSubmission[]> {
  const supabase = createServiceClient()
  let query = supabase.from('brand_submissions').select('*')

  if (status) {
    query = query.eq('status', status)
  }

  query = query.order('submitted_at', { ascending: false })
  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) throw error
  return (data ?? []).map(submissionToDomain)
}

export async function approveSubmission(
  id: string,
  reviewerId: string,
  overrides?: SubmissionApprovalOverrides
): Promise<ApproveSubmissionResult>
export async function approveSubmission(
  supabase: ServiceClient,
  id: string,
  reviewerId: string,
  overrides?: SubmissionApprovalOverrides
): Promise<ApproveSubmissionResult>
export async function approveSubmission(
  first: string | ServiceClient,
  second: string,
  third?: string | SubmissionApprovalOverrides,
  fourth?: SubmissionApprovalOverrides
): Promise<ApproveSubmissionResult> {
  const supabase = typeof first === 'string' ? createServiceClient() : first
  const id = typeof first === 'string' ? first : second
  const reviewerId = typeof first === 'string' ? second : (third as string)
  const overrides = (typeof first === 'string' ? third : fourth) as SubmissionApprovalOverrides | undefined

  const { data: submission, error: fetchError } = await supabase
    .from('brand_submissions')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !submission) {
    throw new NotFoundError('BrandSubmission', id, { cause: fetchError })
  }

  if (submission.status !== 'pending' || submission.brand_id !== null) {
    throw new Error('Submission already processed')
  }

  const enrichedDataRaw = submission.enriched_data
  const enrichedData: EnrichedData | null = isEnrichedData(enrichedDataRaw)
    ? enrichedDataFromDb(enrichedDataRaw as Record<string, unknown>)
    : null
  const overrideInsert = approvalOverridesToBrandInsert(overrides)
  const enrichedInsert = enrichedDataToBrandInsert(enrichedData)
  const brandName =
    overrideInsert.name ??
    enrichedInsert.name ??
    submission.brand_name
  const slug = await resolveUniqueSlug(supabase, generateSlug(brandName))

  const brandInsert: BrandInsert = {
    ...submissionToBrandBase(submission),
    ...enrichedInsert,
    ...overrideInsert,
    name: brandName,
    slug,
    status: 'approved',
  }

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .insert(brandInsert)
    .select('id')
    .single()

  if (brandError || !brand) throw brandError ?? new Error('Failed to create brand')

  const { data, error } = await supabase
    .from('brand_submissions')
    .update({
      brand_id: brand.id,
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id, { cause: error })
  if (isStructuredTags(submission.suggested_tags) && submission.suggested_tags.productType && !Object.prototype.hasOwnProperty.call(overrides ?? {}, 'productType')) {
    const { error: updateError } = await supabase
      .from('brands')
      .update({ product_type: submission.suggested_tags.productType })
      .eq('id', brand.id)

    if (updateError) throw updateError
  }
  return {
    brandId: brand.id,
    submitterEmail: submission.submitter_email,
    brandName: submission.brand_name,
    submitterName: submission.submitter_name ?? null,
    isBrandOwner: submission.is_brand_owner ?? false,
  }
}

export async function rejectSubmission(
  id: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes?: string
): Promise<BrandSubmission> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
      denial_reason: denialReason,
      reviewer_notes: notes ?? null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new NotFoundError('BrandSubmission', id, { cause: error })
  return submissionToDomain(data)
}

export async function checkBrandDuplicates(
  name: string
): Promise<DuplicateCheckResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('check_brand_duplicates', {
    p_name: name,
    p_ubn: null,
  })

  if (error) {
    console.error('[checkBrandDuplicates] RPC error:', error.message)
    return { nameMatches: [] }
  }

  return {
    nameMatches: data?.name_matches ?? [],
  }
}
