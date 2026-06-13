import type { Brand, BrandFilters, SocialLinks } from '@/lib/types'
import type { SiteContent, SiteProduct, SiteTokens } from '@/lib/types/brand'
import type { TaxonomyTag } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { getActiveCategories } from '@/lib/services/taxonomy'
import { BRAND_SORT_CONFIG } from '@/lib/pagination'
import { isNonImageHost } from '@/lib/images/allowed-image-hosts'
import { RESERVED_ROUTES } from '@/middleware'
import { createSubmissionSchema } from '@/lib/validations/submission'
import { downloadAndStoreImages } from './image-download'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandDraftData = BrandRow['draft_data']
type TaxonomyTagRow = Database['public']['Tables']['taxonomy_tags']['Row']
type RawSeedRow = Record<string, unknown>

export const curatedSubmissionSchema = createSubmissionSchema(false).omit({
  _honeypot: true,
  isOwner: true,
  pdpaConsent: true,
  sourceAttribution: true,
  turnstileToken: true,
})

export type CuratedSubmissionInput = {
  name: string
  slug: string
  description: string
  category: string
  logoUrl?: string | null
  productPhotos: string[]
  purchaseLinks: Array<{ platform: string; url: string }>
  socialLinks: { instagram: string; threads: string; facebook: string; website: string }
  retailLocations: Array<{ name: string; address: string }>
  brandHighlights: string | null
  region?: string | null
  valueTags?: string[]
}

type CuratedBrand = Partial<Brand> &
  Pick<
    Brand,
    | 'purchaseLinks'
    | 'socialLinks'
    | 'status'
    | 'heroImageUrl'
    | 'contactEmail'
    | 'foundingYear'
    | 'brandHighlights'
  >

/** Shape returned by: brand_taxonomy(taxonomy_tags(*)) — only the nested tag is used by the mapper */
type BrandTaxonomyWithTag = {
  taxonomy_tags: TaxonomyTagRow | null
}

/** Shape returned by: brand_owners(user_id) */
type BrandOwnerRef = { user_id: string }

/**
 * Full joined row from BRAND_SELECT. Extends Partial<BrandRow> so that
 * unit test fixtures can omit columns added in later migrations (is_demo,
 * tag_slugs, founder, brand_highlights) without a cast — the mapper uses
 * ?? defaults for all optional fields.
 */
export type BrandRowWithJoins = Partial<BrandRow> &
  Pick<BrandRow, 'id' | 'name' | 'slug' | 'status' | 'submitted_at' | 'created_at' | 'updated_at'> & {
    brand_taxonomy?: BrandTaxonomyWithTag[] | null
    brand_owners?: BrandOwnerRef | BrandOwnerRef[] | null
  }

export type SearchResult = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  category: string
  similarity: number
}

export type SimilarBrand = {
  inputName: string
  brandName: string
  brandSlug: string
  score: number
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_ROUTES.has(slug)
}

function getObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`)
  }

  return value as Record<string, unknown>
}

function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (value == null) {
    return ''
  }

  return String(value).trim()
}

function parseJsonString(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON in ${fieldName}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseMaybeJson(value: unknown, fieldName: string): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value
  }

  return parseJsonString(trimmed, fieldName)
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  const parsedValue = parseMaybeJson(value, fieldName)

  if (Array.isArray(parsedValue)) {
    return parsedValue
      .map((item) => getString(item))
      .filter(Boolean)
  }

  const raw = getString(parsedValue)
  if (!raw) {
    return []
  }

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseObjectArray(value: unknown, fieldName: string): Record<string, unknown>[] {
  const parsedValue = parseMaybeJson(value, fieldName)

  if (parsedValue == null || parsedValue === '') {
    return []
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(`${fieldName} must be a JSON array`)
  }

  return parsedValue.map((item, index) => getObject(item, `${fieldName}[${index}]`))
}

function parseSocialLinks(value: unknown): Record<string, unknown> {
  const parsedValue = parseMaybeJson(value, 'socialLinks')

  if (parsedValue == null || parsedValue === '') {
    return {}
  }

  return getObject(parsedValue, 'socialLinks')
}

export function parseBrandCSV(csvText: string): Record<string, string | string[]>[] {
  const rows: string[][] = []
  let currentCell = ''
  let currentRow: string[] = []
  let inQuotes = false

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index]
    const nextChar = csvText[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      currentRow.push(currentCell)
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow)
      }
      currentCell = ''
      currentRow = []
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow)
  }

  if (rows.length === 0) {
    return []
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((header) => header.trim())

  return dataRows.map((cells) => {
    const row: Record<string, string | string[]> = {}
    headers.forEach((header, index) => {
      const value = cells[index] ?? ''
      row[header] = value.includes('|') ? parseStringArray(value, header) : value
    })
    return row
  })
}

export function normalizeRow(rawRow: RawSeedRow): CuratedSubmissionInput {
  const socialLinks =
    'socialLinks' in rawRow ? parseSocialLinks(rawRow.socialLinks) : {}

  const normalized = curatedSubmissionSchema.parse({
    name: getString(rawRow.name),
    description: getString(rawRow.description),
    category: getString(rawRow.category),
    region: getString(rawRow.region) || undefined,
    valueTags: parseStringArray(rawRow.valueTags ?? rawRow.tags, 'valueTags'),
    logoUrl: getString(rawRow.logoUrl),
    productPhotos: parseStringArray(rawRow.productPhotos, 'productPhotos'),
    productTypes: parseStringArray(rawRow.productTypes ?? rawRow.product_type, 'productTypes'),
    productTypeNote: getString(rawRow.productTypeNote ?? rawRow.product_type_note),
    brandHighlights: getString(rawRow.brandHighlights),
    purchaseLinks: parseObjectArray(rawRow.purchaseLinks, 'purchaseLinks'),
    socialLinks: {
      instagram: getString(socialLinks.instagram ?? rawRow.instagram),
      threads: getString(socialLinks.threads ?? rawRow.threads),
      facebook: getString(socialLinks.facebook ?? rawRow.facebook),
      website: getString(
        socialLinks.website ?? socialLinks.officialWebsite ?? rawRow.website ?? rawRow.officialWebsite
      ),
    },
    retailLocations: parseObjectArray(rawRow.retailLocations, 'retailLocations'),
  })

  const slug = getString(rawRow.slug) || generateSlug(normalized.name)
  if (!slug) {
    throw new Error(`Unable to generate slug for brand: ${normalized.name}`)
  }
  if (isReservedSlug(slug)) {
    throw new Error(`Slug conflicts with reserved route: ${slug}`)
  }

  return { ...normalized, slug }
}

export function curatedSubmissionToBrand(input: CuratedSubmissionInput): CuratedBrand {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    logoUrl: input.logoUrl || null,
    heroImageUrl: null,
    status: 'approved',
    category: input.category,
    foundingYear: null,
    purchaseLinks: input.purchaseLinks.map((link) => ({
      ...link,
      label: link.platform,
    })),
    socialLinks: {
      instagram: input.socialLinks.instagram || undefined,
      threads: input.socialLinks.threads || undefined,
      facebook: input.socialLinks.facebook || undefined,
      officialWebsite: input.socialLinks.website || undefined,
    },
    retailLocations: input.retailLocations.map((location) => ({
      ...location,
      latitude: 0,
      longitude: 0,
    })),
    productPhotos: input.productPhotos,
    contactEmail: null,
    brandHighlights: input.brandHighlights?.trim() || null,
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapSocialLinksToDomain(raw: Record<string, string | undefined>): SocialLinks {
  const result: SocialLinks = {}
  if (raw.instagram) result.instagram = raw.instagram
  if (raw.threads) result.threads = raw.threads
  if (raw.facebook) result.facebook = raw.facebook
  if (raw.official_website) result.officialWebsite = raw.official_website
  if (raw.officialWebsite) result.officialWebsite = raw.officialWebsite
  return result
}

function mapSocialLinksToDb(links: SocialLinks): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  if (links.instagram) result.instagram = links.instagram
  if (links.threads) result.threads = links.threads
  if (links.facebook) result.facebook = links.facebook
  if (links.officialWebsite) result.official_website = links.officialWebsite
  return result
}

const BRAND_DRAFT_EDITABLE_KEYS = [
  'name',
  'description',
  'foundingYear',
  'socialLinks',
  'logoUrl',
  'heroImageUrl',
  'productPhotos',
  'brandHighlights',
  'purchaseLinks',
  'retailLocations',
] as const satisfies readonly (keyof Brand)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeSiteTokens(value: unknown): SiteTokens {
  const tokens = isRecord(value) ? value : {}
  const result: SiteTokens = {
    accent: typeof tokens.accent === 'string' ? tokens.accent : '',
  }
  const accentForeground = optionalString(tokens.accentForeground)
  if (accentForeground !== undefined) result.accentForeground = accentForeground
  return result
}

function normalizeSiteProduct(value: unknown): SiteProduct | null {
  if (!isRecord(value)) return null

  const result: SiteProduct = {
    name: typeof value.name === 'string' ? value.name : '',
  }
  const imageUrl = optionalString(value.imageUrl)
  if (imageUrl !== undefined) result.imageUrl = imageUrl
  const url = optionalString(value.url)
  if (url !== undefined) result.url = url
  const caption = optionalString(value.caption)
  if (caption !== undefined) result.caption = caption
  return result
}

export function normalizeSiteContent(raw: unknown): SiteContent | null {
  if (!raw || !isRecord(raw) || Object.keys(raw).length === 0) return null

  const result: SiteContent = {
    template: typeof raw.template === 'string' ? raw.template : 'default',
    tokens: normalizeSiteTokens(raw.tokens),
    products: Array.isArray(raw.products)
      ? raw.products.flatMap((product) => {
          const normalized = normalizeSiteProduct(product)
          return normalized ? [normalized] : []
        })
      : [],
    ctaType: raw.ctaType === 'mailto' ? raw.ctaType : 'mailto',
  }

  const tagline = optionalString(raw.tagline)
  if (tagline !== undefined) result.tagline = tagline
  const story = optionalString(raw.story)
  if (story !== undefined) result.story = story
  const ctaValue = optionalString(raw.ctaValue)
  if (ctaValue !== undefined) result.ctaValue = ctaValue

  return result
}

function normalizeDraftSocialLinks(value: unknown, base: SocialLinks = {}): SocialLinks {
  if (!isRecord(value)) return base

  const result: SocialLinks = { ...base }
  if ('officialWebsite' in value) {
    result.officialWebsite =
      typeof value.officialWebsite === 'string' ? value.officialWebsite : undefined
  }
  if ('instagram' in value) {
    result.instagram = typeof value.instagram === 'string' ? value.instagram : undefined
  }
  if ('threads' in value) {
    result.threads = typeof value.threads === 'string' ? value.threads : undefined
  }
  if ('facebook' in value) {
    result.facebook = typeof value.facebook === 'string' ? value.facebook : undefined
  }
  return result
}

function draftDataToSnapshot(value: BrandDraftData): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function brandToDraftSnapshot(data: Partial<Brand>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const key of BRAND_DRAFT_EDITABLE_KEYS) {
    if (key in data && data[key] !== undefined) {
      snapshot[key] = data[key]
    }
  }
  return snapshot
}

export function draftSnapshotToDomain(
  snapshot: Record<string, unknown>,
  base: Brand
): Partial<Brand> {
  const partial: Partial<Brand> = {}

  for (const key of BRAND_DRAFT_EDITABLE_KEYS) {
    if (!(key in snapshot)) continue

    switch (key) {
      case 'name':
        partial.name = snapshot.name as Brand['name']
        break
      case 'description':
        partial.description = snapshot.description as Brand['description']
        break
      case 'foundingYear':
        partial.foundingYear = snapshot.foundingYear as Brand['foundingYear']
        break
      case 'socialLinks':
        partial.socialLinks = normalizeDraftSocialLinks(snapshot.socialLinks, base.socialLinks)
        break
      case 'logoUrl':
        partial.logoUrl = snapshot.logoUrl as Brand['logoUrl']
        break
      case 'heroImageUrl':
        partial.heroImageUrl = snapshot.heroImageUrl as Brand['heroImageUrl']
        break
      case 'productPhotos':
        partial.productPhotos = snapshot.productPhotos as Brand['productPhotos']
        break
      case 'brandHighlights':
        partial.brandHighlights = snapshot.brandHighlights as Brand['brandHighlights']
        break
      case 'purchaseLinks':
        partial.purchaseLinks = snapshot.purchaseLinks as Brand['purchaseLinks']
        break
      case 'retailLocations':
        partial.retailLocations = snapshot.retailLocations as Brand['retailLocations']
        break
    }
  }

  return partial
}

export function mergeDraftOverBrand(
  brand: Brand,
  snapshot: Record<string, unknown> | null
): Brand {
  return snapshot ? { ...brand, ...draftSnapshotToDomain(snapshot, brand) } : brand
}

export function diffRemovedImageUrls(previous: string[], next: string[]): string[] {
  const nextUrls = new Set(next.filter(Boolean))
  return previous.filter((url) => Boolean(url) && !nextUrls.has(url))
}

export function brandToDomain(row: BrandRowWithJoins): Brand {
  const taxonomyJoin = row.brand_taxonomy ?? []
  const owners = Array.isArray(row.brand_owners)
    ? row.brand_owners
    : row.brand_owners
      ? [row.brand_owners]
      : []
  const tags: TaxonomyTag[] = taxonomyJoin
    .filter((bt) => bt.taxonomy_tags !== null)
    .map((bt) => {
      const t = bt.taxonomy_tags as TaxonomyTagRow
      return {
        id: t.id,
        name: t.name,
        nameZh: t.name_zh ?? null,
        slug: t.slug,
        // taxonomy_tags.category is text in the DB — cast to TagCategory at the boundary
        category: t.category as TaxonomyTag['category'],
        isActive: t.is_active ?? true,
        createdAt: t.created_at ?? '',
      }
    })

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    logoUrl: row.logo_url ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    // status is text in the DB — cast to BrandStatus at the boundary
    status: row.status as Brand['status'],
    category: row.category ?? null,
    isVerified: owners.length > 0,
    mitStatus: (row.mit_status as Brand['mitStatus']) ?? 'unverified',
    mitVerifiedAt: row.mit_verified_at ?? null,
    mitEvidence: (row.mit_evidence as Brand['mitEvidence']) ?? null,
    mitVerified: row.mit_status === 'verified',
    isDemo: row.is_demo ?? false,
    foundingYear: row.founding_year ?? null,
    // Json columns are cast to domain types at the service boundary
    purchaseLinks: (row.purchase_links as Brand['purchaseLinks']) ?? [],
    socialLinks: mapSocialLinksToDomain((row.social_links as Record<string, string | undefined>) ?? {}),
    retailLocations: (row.retail_locations as Brand['retailLocations']) ?? [],
    productPhotos: (row.product_photos as string[]) ?? [],
    contactEmail: row.contact_email ?? null,
    brandHighlights: row.brand_highlights ?? null,
    siteContent: normalizeSiteContent(row.site_content as Brand['siteContent']),
    tags,
    submittedAt: row.submitted_at ?? '',
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

export function brandToInsert(data: Partial<Brand>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (data.name !== undefined) row.name = data.name
  if (data.slug !== undefined) row.slug = data.slug
  if (data.description !== undefined) row.description = data.description
  if (data.logoUrl !== undefined) row.logo_url = data.logoUrl
  if (data.heroImageUrl !== undefined) row.hero_image_url = data.heroImageUrl
  if (data.status !== undefined) row.status = data.status
  if (data.category !== undefined) row.category = data.category
  if (data.foundingYear !== undefined) row.founding_year = data.foundingYear
  if (data.purchaseLinks !== undefined) row.purchase_links = data.purchaseLinks
  if (data.socialLinks !== undefined) row.social_links = mapSocialLinksToDb(data.socialLinks)
  if (data.retailLocations !== undefined) row.retail_locations = data.retailLocations
  if (data.productPhotos !== undefined) row.product_photos = data.productPhotos
  if (data.contactEmail !== undefined) row.contact_email = data.contactEmail
  if (data.brandHighlights != null) row.brand_highlights = data.brandHighlights
  if (data.isDemo) row.is_demo = data.isDemo
  return row
}

function brandToUpdate(data: Partial<Brand>): Record<string, unknown> {
  const row = brandToInsert(data)

  if (data.brandHighlights !== undefined) {
    row.brand_highlights = data.brandHighlights === '' ? null : data.brandHighlights
  }

  return row
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export const BRAND_SELECT =
  '*, brand_taxonomy(taxonomy_tags(*)), brand_owners(user_id)'
const VERIFIED_BRAND_SELECT =
  '*, brand_taxonomy(taxonomy_tags(*)), brand_owners!inner(user_id)'

export async function getBrands(
  filters?: BrandFilters
): Promise<{ brands: Brand[]; totalCount: number }> {
  const supabase = createServiceClient()

  // When a search term is present, use the search_brands pg_trgm RPC for ranked/fuzzy results.
  // Fetch a generous pool of ranked IDs, then apply all remaining filters + pagination over them.
  if (filters?.search) {
    const trimmed = filters.search.trim().slice(0, 100)
    if (!trimmed) {
      return { brands: [], totalCount: 0 }
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('search_brands', {
      search_query: trimmed,
      result_limit: 500, // generous pool — filters + pagination narrow this down
    })

    if (rpcError) {
      console.error('getBrands search_brands RPC error:', rpcError)
      return { brands: [], totalCount: 0 }
    }

    const rankedIds: string[] = (rpcData ?? []).map((row: { id: string }) => row.id)
    if (rankedIds.length === 0) {
      return { brands: [], totalCount: 0 }
    }

    // Apply remaining filters over the ranked ID set
    const verificationFilter = filters.verificationFilter
    const selectClause =
      verificationFilter === 'owned' ? VERIFIED_BRAND_SELECT : BRAND_SELECT

    let query = supabase.from('brands').select(selectClause, { count: 'exact' }).in('id', rankedIds)

    if (verificationFilter === 'mit-verified') {
      query = query.eq('mit_status', 'verified')
    }

    if (!filters.includeTestBrands) {
      query = query.not('name', 'like', '[E2E-TEST]%')
    }
    if (filters.status) {
      query = query.eq('status', filters.status)
    }
    if (filters.category && filters.category.length > 0) {
      query = query.overlaps('tag_slugs', filters.category)
    }
    if (filters.tags && filters.tags.length > 0) {
      query = query.overlaps('tag_slugs', filters.tags)
    }

    // Sorting
    const sortKey = filters.sort ?? 'name'
    const sortConfig = BRAND_SORT_CONFIG[sortKey]
    query = query.order(sortConfig.column, { ascending: sortConfig.ascending })

    // Pagination
    if (filters.limit !== undefined) {
      const offset = filters.offset ?? 0
      query = query.range(offset, offset + filters.limit - 1)
    }

    const { data, error, count } = await query
    if (error) throw error
    return { brands: (data ?? []).map(brandToDomain), totalCount: count ?? 0 }
  }

  const verificationFilter = filters?.verificationFilter
  const selectClause = verificationFilter === 'owned' ? VERIFIED_BRAND_SELECT : BRAND_SELECT

  let query = supabase.from('brands').select(selectClause, { count: 'exact' })

  if (verificationFilter === 'mit-verified') {
    query = query.eq('mit_status', 'verified')
  }

  if (!filters?.includeTestBrands) {
    query = query.not('name', 'like', '[E2E-TEST]%')
  }
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.category && filters.category.length > 0) {
    // brand has at least one of these category (product_type) tag slugs
    query = query.overlaps('tag_slugs', filters.category)
  }
  if (filters?.tags && filters.tags.length > 0) {
    // brand has at least one of these value tags
    query = query.overlaps('tag_slugs', filters.tags)
  }

  // Sorting
  const sortKey = filters?.sort ?? 'name'
  const sortConfig = BRAND_SORT_CONFIG[sortKey]
  query = query.order(sortConfig.column, { ascending: sortConfig.ascending })

  // Pagination
  if (filters?.limit !== undefined) {
    const offset = filters.offset ?? 0
    query = query.range(offset, offset + filters.limit - 1)
  }

  const { data, error, count } = await query

  if (error) throw error
  return { brands: (data ?? []).map(brandToDomain), totalCount: count ?? 0 }
}

export async function getBrandBySlug(slug: string): Promise<Brand> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) throw new NotFoundError('Brand', slug)
  return brandToDomain(data)
}

export async function createBrand(
  data: Omit<Brand, 'id' | 'tags' | 'submittedAt' | 'approvedAt' | 'createdAt' | 'updatedAt'> & {
    unifiedBusinessNumber?: string | null
  }
): Promise<Brand> {
  const supabase = createServiceClient()
  const slug = data.slug || generateSlug(data.name)

  // Check slug against reserved routes
  if (isReservedSlug(slug)) {
    throw new ValidationError(`Brand slug conflicts with a reserved route: ${slug}`)
  }

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) throw new ValidationError(`Brand slug already exists: ${slug}`)

  const row = brandToInsert({ ...data, slug })
  row.unified_business_number = data.unifiedBusinessNumber ?? null
  const { data: inserted, error } = await supabase
    .from('brands')
    .insert(row)
    .select(BRAND_SELECT)
    .single()

  if (error) throw error
  return brandToDomain(inserted)
}

export async function updateBrand(id: string, data: Partial<Brand>): Promise<Brand> {
  const supabase = createServiceClient()
  const row = brandToUpdate(data)
  const { data: updated, error } = await supabase
    .from('brands')
    .update(row)
    .eq('id', id)
    .select(BRAND_SELECT)
    .single()

  if (error || !updated) throw new NotFoundError('Brand', id)
  return brandToDomain(updated)
}

export async function saveDraft(brandId: string, data: Partial<Brand>): Promise<void> {
  const supabase = createServiceClient()
  const { error, count } = await supabase
    .from('brands')
    .update(
      {
        draft_data: brandToDraftSnapshot(data) as BrandDraftData,
        draft_updated_at: new Date().toISOString(),
      },
      { count: 'exact' },
    )
    .eq('id', brandId)

  if (error) throw error
  if (count === 0) throw new NotFoundError('Brand', brandId)
}

export async function getBrandDraft(brandId: string): Promise<Record<string, unknown> | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('draft_data')
    .eq('id', brandId)
    .maybeSingle()

  if (error) throw error
  return draftDataToSnapshot(data?.draft_data ?? null)
}

export async function publishDraft(brandId: string): Promise<Brand> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('draft_data')
    .eq('id', brandId)
    .single()

  if (error || !data) throw new NotFoundError('Brand', brandId)

  const snapshot = draftDataToSnapshot(data.draft_data)
  if (!snapshot) throw new ValidationError('No draft to publish')

  const currentBrand = await getBrandById(brandId)
  const partial = draftSnapshotToDomain(snapshot, currentBrand)
  const published = await updateBrand(brandId, partial)

  const { error: clearError, count } = await supabase
    .from('brands')
    .update({ draft_data: null, draft_updated_at: null }, { count: 'exact' })
    .eq('id', brandId)

  if (clearError) throw clearError
  if (count === 0) throw new NotFoundError('Brand', brandId)

  return published
}

export async function discardDraft(
  brandId: string,
): Promise<{ snapshot: Record<string, unknown> | null }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('draft_data')
    .eq('id', brandId)
    .maybeSingle()

  if (error) throw error

  const snapshot = draftDataToSnapshot(data?.draft_data ?? null)
  const { error: clearError, count } = await supabase
    .from('brands')
    .update({ draft_data: null, draft_updated_at: null }, { count: 'exact' })
    .eq('id', brandId)

  if (clearError) throw clearError
  if (count === 0) throw new NotFoundError('Brand', brandId)

  return { snapshot }
}

export async function deleteBrand(id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error, count } = await supabase
    .from('brands')
    .delete({ count: 'exact' })
    .eq('id', id)

  if (error) throw error
  if (count === 0) throw new NotFoundError('Brand', id)
}

export async function hideBrand(id: string): Promise<Brand> {
  return updateBrand(id, { status: 'hidden' })
}

export async function getRelatedBrands(
  category: string,
  excludeSlug: string,
  limit = 4,
): Promise<Brand[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('status', 'approved')
    .eq('category', category)
    .neq('slug', excludeSlug)
    .limit(limit)

  if (error) throw error
  return (data ?? []).map(brandToDomain)
}

export async function getBrandCountByCategory(
  category: string,
  excludeSlug: string,
): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brands')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
    .eq('category', category)
    .neq('slug', excludeSlug)

  if (error) throw error
  return count ?? 0
}

export async function getAllBrandSlugs(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('slug')
    .eq('status', 'approved')

  if (error) throw error
  return (data ?? []).map((row) => row.slug)
}

export async function getMicrositeSlugs(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('slug')
    .eq('status', 'approved')
    .not('site_content', 'is', null)

  if (error) throw error
  return (data ?? []).map((row) => row.slug)
}

export async function getBrandById(id: string): Promise<Brand> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('id', id)
    .single()

  if (error || !data) throw new NotFoundError('Brand', id)
  return brandToDomain(data)
}

function isSupabaseStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const storagePrefix = supabaseUrl ? `${supabaseUrl}/storage/` : ''

  if (storagePrefix && url.startsWith(storagePrefix)) {
    return true
  }

  try {
    const parsedUrl = new URL(url)
    const normalizedHostname = parsedUrl.hostname.toLowerCase()

    return (
      normalizedHostname.endsWith('.supabase.co') &&
      parsedUrl.pathname.startsWith('/storage/')
    )
  } catch {
    return false
  }
}

export function collectSyncableImageUrls(input: {
  heroImageUrl: string | null
  logoUrl: string | null
  productPhotos: string[]
}): string[] {
  const urls = [input.heroImageUrl, input.logoUrl, ...input.productPhotos]

  return urls.filter((url): url is string => {
    if (!url) {
      return false
    }

    return !isSupabaseStorageUrl(url) && !isNonImageHost(url)
  })
}

export type ImageRef = {
  url: string
  field: 'hero' | 'logo' | 'photo'
  index?: number
}

export function buildSyncedImagePatch(
  refs: ImageRef[],
  storedUrls: (string | null)[],
  productPhotos: string[],
): Partial<{ heroImageUrl: string; logoUrl: string; productPhotos: string[] }> {
  const patch: Partial<{ heroImageUrl: string; logoUrl: string; productPhotos: string[] }> = {}
  const updatedPhotos = [...productPhotos]

  for (let i = 0; i < refs.length; i++) {
    const stored = storedUrls[i]
    if (stored == null) {
      continue
    }

    const ref = refs[i]
    if (ref.field === 'hero') patch.heroImageUrl = stored
    else if (ref.field === 'logo') patch.logoUrl = stored
    else if (ref.field === 'photo' && ref.index !== undefined) updatedPhotos[ref.index] = stored
  }

  patch.productPhotos = updatedPhotos
  return patch
}

export async function syncBrandImages(brandId: string): Promise<{ synced: number; failed: number }> {
  const brand = await getBrandById(brandId)

  const syncableUrls = collectSyncableImageUrls({
    heroImageUrl: brand.heroImageUrl,
    logoUrl: brand.logoUrl,
    productPhotos: brand.productPhotos,
  })

  if (syncableUrls.length === 0) return { synced: 0, failed: 0 }

  const refs: ImageRef[] = []

  if (brand.heroImageUrl && syncableUrls.includes(brand.heroImageUrl)) {
    refs.push({ url: brand.heroImageUrl, field: 'hero' })
  }
  if (brand.logoUrl && syncableUrls.includes(brand.logoUrl)) {
    refs.push({ url: brand.logoUrl, field: 'logo' })
  }
  for (let i = 0; i < brand.productPhotos.length; i++) {
    const url = brand.productPhotos[i]
    if (url && syncableUrls.includes(url)) {
      refs.push({ url, field: 'photo', index: i })
    }
  }

  if (refs.length === 0) return { synced: 0, failed: 0 }

  const externalUrls = refs.map((r) => r.url)
  const storedUrls = await downloadAndStoreImages(externalUrls, brandId)

  const patch = buildSyncedImagePatch(refs, storedUrls, brand.productPhotos)
  await updateBrand(brandId, patch)

  const failed = storedUrls.filter((u) => u == null).length
  return { synced: storedUrls.length - failed, failed }
}

export async function completeBrandClaim({
  userId,
  brandId,
  email,
}: {
  userId: string
  brandId: string
  email: string
}): Promise<void> {
  const supabase = createServiceClient()

  const { error: insertError } = await supabase
    .from('brand_owners')
    .insert({ user_id: userId, brand_id: brandId })
    .select()
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      throw new ValidationError('This brand has already been claimed')
    }
    throw insertError
  }

  const { error: updateError } = await supabase
    .from('brands')
    .update({ contact_email: email })
    .eq('id', brandId)

  if (updateError) throw updateError
}

export async function searchBrands(query: string, limit: number = 5): Promise<SearchResult[]> {
  const trimmed = query.trim().slice(0, 100)
  if (!trimmed) return []

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('search_brands', {
    search_query: trimmed,
    result_limit: limit,
  })

  if (error) {
    console.error('searchBrands RPC error:', error)
    return []
  }

  return (data ?? []).map((row: {
    id: string
    name: string
    slug: string
    logo_url: string | null
    primary_category_name: string
    similarity_score: number
  }) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    category: row.primary_category_name,
    similarity: row.similarity_score,
  }))
}

export async function findSimilarBrands(names: string[]): Promise<SimilarBrand[]> {
  if (names.length === 0) return []

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('find_similar_brands', {
    p_names: names,
    p_threshold: 0.3,
  })
  if (error) throw new Error(`findSimilarBrands: ${error.message}`)

  return (data ?? []).map((row: {
    input_name: string
    brand_name: string
    brand_slug: string
    similarity_score: number
  }) => ({
    inputName: row.input_name,
    brandName: row.brand_name,
    brandSlug: row.brand_slug,
    score: row.similarity_score,
  }))
}

export async function getRandomBrands(limit = 4): Promise<Brand[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('status', 'approved')
    .limit(limit * 3)

  if (error) throw error

  const rows = data ?? []
  if (rows.length === 0) return []

  // Fisher-Yates shuffle
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
  }

  return rows.slice(0, limit).map(brandToDomain)
}

export async function getNewBrands(limit = 4): Promise<Brand[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []).map(brandToDomain)
}

export async function getBrandStats(): Promise<{ brandCount: number; categoryCount: number }> {
  const supabase = createServiceClient()
  const [{ count, error }, categories] = await Promise.all([
    supabase
      .from('brands')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved'),
    getActiveCategories(),
  ])

  if (error) throw error
  return { brandCount: count ?? 0, categoryCount: categories.length }
}
