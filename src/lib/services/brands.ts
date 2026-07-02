import type { Brand, BrandFilters, CustomerVoice, OtherUrl } from '@/lib/types'
import type { SiteContent, SiteProduct, SiteTokens } from '@/lib/types/brand'
import type { Database } from '@/lib/supabase/database.types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { BRAND_SORT_CONFIG, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { isNonImageHost } from '@/lib/images/allowed-image-hosts'
import { RESERVED_ROUTES } from '@/middleware'
import { deriveCategoryFromProductType } from '@/lib/taxonomy/ontology'
import { downloadAndStoreImages } from './image-download'

function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandRow = Database['public']['Tables']['brands']['Row']
type BrandDraftData = BrandRow['draft_data']
type BrandSlugRedirectRow = { new_slug: string }
type BrandSlugRedirectTable = {
  select: (columns: 'new_slug') => {
    eq: (column: 'old_slug', value: string) => {
      single: () => Promise<{
        data: BrandSlugRedirectRow | null
        error: { code?: string; message?: string } | null
      }>
    }
  }
  upsert: (row: { old_slug: string; new_slug: string }) => Promise<{
    error: { code?: string; message?: string } | null
  }>
}
type BrandFlatLinkColumns = {
  social_instagram?: string | null
  social_threads?: string | null
  social_facebook?: string | null
  purchase_website?: string | null
  purchase_pinkoi?: string | null
  purchase_shopee?: string | null
  other_urls?: unknown
}

export type CuratedSubmissionInput = {
  name: string
  slug: string
  description: string
  category: string
  productType?: string
  heroImageUrl?: string | null
  productPhotos: string[]
  purchaseLinks: Array<{ platform: string; url: string }>
  socialLinks: { instagram: string; threads: string; facebook: string; website: string }
  retailLocations: Array<{ name: string; address: string }>
  region?: string | null
}

type CuratedBrand = Partial<Brand> &
  Pick<
    Brand,
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
    | 'otherUrls'
    | 'status'
    | 'heroImageUrl'
    | 'contactEmail'
    | 'foundingYear'
  > & { productType: string }

type BrandWriteInput = Partial<Brand> & { productType?: string | null }

/** Shape returned by: brand_owners(user_id) */
type BrandOwnerRef = { user_id: string }

/**
 * Full joined row from BRAND_SELECT. Extends Partial<BrandRow> so that
 * unit test fixtures can omit columns added in later migrations (is_demo,
 * price_range, product_tags) without a cast — the mapper uses
 * ?? defaults for all optional fields.
 */
export type BrandRowWithJoins = Partial<BrandRow> &
  BrandFlatLinkColumns &
  {
    price_range?: number | null
    product_tags?: string[] | null
  } &
  Pick<BrandRow, 'id' | 'name' | 'slug' | 'status' | 'submitted_at' | 'created_at' | 'updated_at'> & {
    brand_owners?: BrandOwnerRef | BrandOwnerRef[] | null
  }

export type SearchResult = {
  id: string
  name: string
  slug: string
  category: string
  rankScore: number
  searchSource: string
  /** @deprecated Use rankScore. Kept for existing autocomplete consumers. */
  similarity: number
}

type SearchBrandsRow = {
  id: string
  name: string
  slug: string
  hero_image_url: string | null
  primary_category_name: string | null
  rank_score: number
  search_source: string
}

type SearchBrandsResult = {
  data: SearchBrandsRow[] | null
  error: { code?: string; message?: string } | null
}

export type SearchBrandAutocompleteResult = {
  id: string
  slug: string
  name: string
  category: string
}

export type SimilarBrand = {
  inputName: string
  brandName: string
  brandSlug: string
  score: number
}

export type BrandEnrichment = {
  productType: string
  heroImageUrl: string | null
  productPhotos: string[]
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function generateSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_ROUTES.has(slug)
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

export function curatedSubmissionToBrand(input: CuratedSubmissionInput): CuratedBrand {
  const purchaseWebsite =
    input.socialLinks.website ||
    input.purchaseLinks.find((link) => ['website', 'official'].includes(link.platform.toLowerCase()))?.url ||
    null
  const purchasePinkoi =
    input.purchaseLinks.find((link) => link.platform.toLowerCase() === 'pinkoi')?.url ?? null
  const purchaseShopee =
    input.purchaseLinks.find((link) => link.platform.toLowerCase() === 'shopee')?.url ?? null
  const otherUrls = input.purchaseLinks
    .filter((link) => !['website', 'official', 'pinkoi', 'shopee'].includes(link.platform.toLowerCase()))
    .map((link) => ({ label: link.platform, url: link.url }))

  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    heroImageUrl: input.heroImageUrl || null,
    status: 'approved',
    category: input.category,
    productType: input.productType ?? input.category,
    foundingYear: null,
    socialInstagram: input.socialLinks.instagram || null,
    socialThreads: input.socialLinks.threads || null,
    socialFacebook: input.socialLinks.facebook || null,
    purchaseWebsite,
    purchasePinkoi,
    purchaseShopee,
    otherUrls,
    retailLocations: input.retailLocations.map((location) => ({
      ...location,
      latitude: 0,
      longitude: 0,
    })),
    productPhotos: input.productPhotos,
    contactEmail: null,
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const BRAND_DRAFT_EDITABLE_KEYS = [
  'name',
  'description',
  'productType',
  'foundingYear',
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  'heroImageUrl',
  'productPhotos',
  'priceRange',
  'productTags',
  'purchaseWebsite',
  'purchasePinkoi',
  'purchaseShopee',
  'otherUrls',
  'retailLocations',
  'customerVoices',
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
  _base?: Brand
): Partial<Brand> {
  void _base
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
      case 'productType': {
        const productType = snapshot.productType as Brand['productType']
        partial.productType = productType
        partial.category = productType
          ? deriveCategoryFromProductType(productType) ?? productType
          : null
        break
      }
      case 'foundingYear':
        partial.foundingYear = snapshot.foundingYear as Brand['foundingYear']
        break
      case 'socialInstagram':
        partial.socialInstagram = snapshot.socialInstagram as Brand['socialInstagram']
        break
      case 'socialThreads':
        partial.socialThreads = snapshot.socialThreads as Brand['socialThreads']
        break
      case 'socialFacebook':
        partial.socialFacebook = snapshot.socialFacebook as Brand['socialFacebook']
        break
      case 'heroImageUrl':
        partial.heroImageUrl = snapshot.heroImageUrl as Brand['heroImageUrl']
        break
      case 'productPhotos':
        partial.productPhotos = (snapshot.productPhotos as Brand['productPhotos']) ?? []
        break
      case 'priceRange':
        partial.priceRange = snapshot.priceRange as Brand['priceRange']
        break
      case 'productTags':
        partial.productTags = (snapshot.productTags as Brand['productTags']) ?? []
        break
      case 'purchaseWebsite':
        partial.purchaseWebsite = snapshot.purchaseWebsite as Brand['purchaseWebsite']
        break
      case 'purchasePinkoi':
        partial.purchasePinkoi = snapshot.purchasePinkoi as Brand['purchasePinkoi']
        break
      case 'purchaseShopee':
        partial.purchaseShopee = snapshot.purchaseShopee as Brand['purchaseShopee']
        break
      case 'otherUrls':
        partial.otherUrls = (snapshot.otherUrls as Brand['otherUrls']) ?? []
        break
      case 'retailLocations':
        partial.retailLocations = (snapshot.retailLocations as Brand['retailLocations']) ?? []
        break
      case 'customerVoices':
        partial.customerVoices = (snapshot.customerVoices as Brand['customerVoices']) ?? []
        break
    }
  }

  return partial
}

export function mergeDraftOverBrand(
  brand: Brand,
  snapshot: Record<string, unknown> | null
): Brand {
  return snapshot ? { ...brand, ...draftSnapshotToDomain(snapshot) } : brand
}

export function diffRemovedImageUrls(previous: string[], next: string[]): string[] {
  const nextUrls = new Set(next.filter(Boolean))
  return previous.filter((url) => Boolean(url) && !nextUrls.has(url))
}

export function brandToDomain(row: BrandRowWithJoins): Brand {
  const owners = Array.isArray(row.brand_owners)
    ? row.brand_owners
    : row.brand_owners
      ? [row.brand_owners]
      : []

  const brand = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    // status is text in the DB — cast to BrandStatus at the boundary
    status: row.status as Brand['status'],
    product_type: row.product_type ?? null,
    productType: row.product_type ?? null,
    category: deriveCategoryFromProductType(row.product_type ?? '') ?? row.product_type ?? null,
    isVerified: owners.length > 0,
    mitStatus: (row.mit_status as Brand['mitStatus']) ?? 'unverified',
    mitVerifiedAt: row.mit_verified_at ?? null,
    mitEvidence: (row.mit_evidence as Brand['mitEvidence']) ?? null,
    mitVerified: row.mit_status === 'verified',
    isDemo: row.is_demo ?? false,
    foundingYear: row.founding_year ?? null,
    socialInstagram: row.social_instagram ?? null,
    socialThreads: row.social_threads ?? null,
    socialFacebook: row.social_facebook ?? null,
    purchaseWebsite: row.purchase_website ?? null,
    purchasePinkoi: row.purchase_pinkoi ?? null,
    purchaseShopee: row.purchase_shopee ?? null,
    otherUrls: (row.other_urls as OtherUrl[]) ?? [],
    retailLocations: (row.retail_locations as Brand['retailLocations']) ?? [],
    customerVoices: (row.customer_voices as CustomerVoice[]) ?? [],
    productPhotos: (row.product_photos as string[]) ?? [],
    contactEmail: row.contact_email ?? null,
    priceRange: row.price_range ?? null,
    productTags: Array.isArray(row.product_tags) ? row.product_tags : [],
    siteContent: normalizeSiteContent(row.site_content as Brand['siteContent']),
    submittedAt: row.submitted_at ?? '',
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
  return brand
}

export function brandToInsert(data: BrandWriteInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (data.name !== undefined) row.name = data.name
  if (data.slug !== undefined) row.slug = data.slug
  if (data.description !== undefined) row.description = data.description
  if (data.heroImageUrl !== undefined) row.hero_image_url = data.heroImageUrl
  if (data.status !== undefined) row.status = data.status
  if (data.productType !== undefined) {
    row.product_type = data.productType
  } else if (data.category != null) {
    row.product_type = data.category
  }
  if (data.foundingYear !== undefined) row.founding_year = data.foundingYear
  if (data.socialInstagram !== undefined) row.social_instagram = data.socialInstagram
  if (data.socialThreads !== undefined) row.social_threads = data.socialThreads
  if (data.socialFacebook !== undefined) row.social_facebook = data.socialFacebook
  if (data.purchaseWebsite !== undefined) row.purchase_website = data.purchaseWebsite
  if (data.purchasePinkoi !== undefined) row.purchase_pinkoi = data.purchasePinkoi
  if (data.purchaseShopee !== undefined) row.purchase_shopee = data.purchaseShopee
  if (data.otherUrls !== undefined) row.other_urls = data.otherUrls
  if (data.retailLocations !== undefined) row.retail_locations = data.retailLocations
  if (data.customerVoices !== undefined) row.customer_voices = data.customerVoices
  if (data.productPhotos !== undefined) row.product_photos = data.productPhotos
  if (data.contactEmail !== undefined) row.contact_email = data.contactEmail
  row.price_range = data.priceRange ?? null
  row.product_tags = data.productTags ?? []
  if (data.isDemo) row.is_demo = data.isDemo
  return row
}

function brandToUpdate(data: BrandWriteInput): Record<string, unknown> {
  return brandToInsert(data)
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

const BRAND_COLUMNS = [
  'id', 'name', 'slug', 'description', 'hero_image_url',
  'product_type', 'contact_email', 'customer_voices', 'purchase_website', 'purchase_pinkoi',
  'purchase_shopee', 'social_instagram', 'social_threads', 'social_facebook',
  'other_urls', 'retail_locations', 'product_photos', 'site_content',
  'status', 'submitted_at', 'approved_at', 'created_at', 'updated_at',
  'draft_data', 'draft_updated_at', 'founding_year',
  'price_range', 'product_tags',
  'mit_status', 'mit_verified_at',
  'mit_evidence', 'source', 'is_demo',
].join(', ')

export const BRAND_SELECT =
  `${BRAND_COLUMNS}, brand_owners(user_id)` as unknown as '*'
const VERIFIED_BRAND_SELECT =
  `${BRAND_COLUMNS}, brand_owners!inner(user_id)` as unknown as '*'

export async function getBrandSlugsBatch(brandIds: string[]): Promise<Map<string, string>> {
  if (brandIds.length === 0) return new Map()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id, slug')
    .in('id', brandIds)
  if (error) throw new Error(`Failed to fetch brand slugs: ${error.message}`)
  return new Map((data ?? []).map(b => [b.id, b.slug]))
}

type GetBrandsFilters = BrandFilters & { page?: number }

function getSearchPagination(filters: GetBrandsFilters): { offset: number; limit?: number } {
  if (filters.limit !== undefined) {
    return {
      offset: filters.offset ?? (filters.page ? (filters.page - 1) * filters.limit : 0),
      limit: filters.limit,
    }
  }

  if (filters.page !== undefined) {
    return {
      offset: (filters.page - 1) * DEFAULT_PAGE_SIZE,
      limit: DEFAULT_PAGE_SIZE,
    }
  }

  return { offset: filters.offset ?? 0 }
}

export async function getBrands(
  filters?: GetBrandsFilters
): Promise<{ brands: Brand[]; totalCount: number }> {
  const supabase = createServiceClient()

  // Search filtering is handled in search_brands; this branch only hydrates the matched IDs.
  // Use typeof check so empty string '' still enters this branch and returns early (not fallthrough to browse).
  if (typeof filters?.search === 'string') {
    const trimmed = filters.search.trim().slice(0, 100)
    if (!trimmed) {
      return { brands: [], totalCount: 0 }
    }

    const verificationFilter =
      filters.verificationFilter && filters.verificationFilter !== 'all'
        ? filters.verificationFilter
        : null

    const { data: rpcData, error: rpcError } = (await supabase.rpc('search_brands', {
      search_query: trimmed,
      result_limit: null,
      prefix_mode: false,
      filter_categories: filters.category?.length ? filters.category : null,
      filter_verification: verificationFilter,
      filter_status: filters.status || 'approved',
      include_test_brands: filters.includeTestBrands ?? false,
    })) as SearchBrandsResult

    if (rpcError) {
      console.error('getBrands search_brands RPC error:', rpcError)
      return { brands: [], totalCount: 0 }
    }

    let matchedRows = rpcData ?? []
    if (filters.priceRanges?.length && matchedRows.length > 0) {
      const { data: priceMatches, error: priceError } = await supabase
        .from('brands')
        .select('id')
        .in('id', matchedRows.map((row) => row.id))
        .in('price_range', filters.priceRanges)

      if (priceError) throw priceError
      const matchingIds = new Set((priceMatches ?? []).map((row) => row.id))
      matchedRows = matchedRows.filter((row) => matchingIds.has(row.id))
    }

    const searchResults: SearchResult[] = matchedRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.primary_category_name ?? '',
      rankScore: row.rank_score,
      searchSource: row.search_source,
      similarity: row.rank_score,
    }))
    const allIds = searchResults.map((result) => result.id)
    const totalCount = allIds.length
    if (totalCount === 0) {
      return { brands: [], totalCount: 0 }
    }

    const selectClause =
      verificationFilter === 'owned' ? VERIFIED_BRAND_SELECT : BRAND_SELECT
    const { offset, limit: pageLimit } = getSearchPagination(filters)
    const pageEnd = pageLimit === undefined ? undefined : offset + pageLimit

    async function hydrateByIds(ids: string[]): Promise<Brand[]> {
      if (ids.length === 0) return []

      const { data, error } = await supabase
        .from('brands')
        .select(selectClause)
        .in('id', ids)

      if (error) throw error

      return (data ?? []).map(brandToDomain)
    }

    const sortKey = filters.sort

    if (!sortKey) {
      const pageIds = allIds.slice(offset, pageEnd)
      const rankById = new Map(pageIds.map((id, index) => [id, index]))
      const brands = (await hydrateByIds(pageIds)).sort(
        (left, right) => (rankById.get(left.id) ?? 0) - (rankById.get(right.id) ?? 0)
      )
      return { brands, totalCount }
    }

    if (sortKey === 'random') {
      const shuffledIds = [...allIds]
      shuffleArray(shuffledIds)
      const pageIds = shuffledIds.slice(offset, pageEnd)
      const positionById = new Map(pageIds.map((id, index) => [id, index]))
      const brands = (await hydrateByIds(pageIds)).sort(
        (left, right) => (positionById.get(left.id) ?? 0) - (positionById.get(right.id) ?? 0)
      )
      return { brands, totalCount }
    }

    const sortConfig = BRAND_SORT_CONFIG[sortKey]
    const { data, error } = await supabase
      .from('brands')
      .select(selectClause)
      .in('id', allIds)
      .order(sortConfig.column, { ascending: sortConfig.ascending })

    if (error) throw error

    const brands = (data ?? [])
      .map(brandToDomain)
      .slice(offset, pageEnd)
    return { brands, totalCount }
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
    query = query.in('product_type', filters.category)
  }
  if (filters?.priceRanges && filters.priceRanges.length > 0) {
    query = query.in('price_range', filters.priceRanges)
  }

  // Sorting
  const sortKey = filters?.sort ?? 'random'
  if (sortKey !== 'random') {
    const sortConfig = BRAND_SORT_CONFIG[sortKey]
    query = query.order(sortConfig.column, { ascending: sortConfig.ascending })
  }

  // Pagination
  if (filters?.limit !== undefined) {
    const offset = filters.offset ?? 0
    query = query.range(offset, offset + filters.limit - 1)
  }

  const { data, error, count } = await query

  if (error) {
    if (error.code === 'PGRST103') return { brands: [], totalCount: count ?? 0 }
    throw error
  }
  const brands = (data ?? []).map(brandToDomain)
  if (sortKey === 'random') shuffleArray(brands)
  return { brands, totalCount: count ?? 0 }
}

export async function searchBrandsAutocomplete(
  query: string,
  limit?: number
): Promise<SearchBrandAutocompleteResult[]> {
  const supabase = createServiceClient()
  const { data, error } = (await supabase.rpc('search_brands', {
    search_query: query,
    prefix_mode: true,
    result_limit: limit ?? 5,
  })) as SearchBrandsResult

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.primary_category_name ?? '',
  }))
}

export async function getBrandBySlug(slug: string): Promise<Brand> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_SELECT)
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) throw new NotFoundError('Brand', slug, { cause: error })
  return brandToDomain(data)
}

/**
 * Returns an approved brand by slug.
 * Throws {@link NotFoundError} if the brand does not exist or is not approved.
 */
export async function getApprovedBrandBySlug(slug: string): Promise<Brand> {
  const brand = await getBrandBySlug(slug)
  if (brand.status !== 'approved') throw new NotFoundError('Brand', slug)
  return brand
}

function brandSlugRedirectsTable(client: unknown): BrandSlugRedirectTable {
  return (client as { from: (table: 'brand_slug_redirects') => BrandSlugRedirectTable }).from('brand_slug_redirects')
}

export async function findBrandByOldSlug(oldSlug: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await brandSlugRedirectsTable(supabase)
    .select('new_slug')
    .eq('old_slug', oldSlug)
    .single()

  if (error) {
    if (error.code === 'PGRST116' || error.code === 'PGRST205') return null
    throw error
  }

  return data?.new_slug ?? null
}

export async function insertSlugRedirect(oldSlug: string, newSlug: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await brandSlugRedirectsTable(supabase).upsert({ old_slug: oldSlug, new_slug: newSlug })

  if (error) throw error
}

export async function updateBrand(id: string, data: BrandWriteInput): Promise<Brand> {
  const supabase = createServiceClient()
  const row = brandToUpdate(data)
  const { data: updated, error } = await supabase
    .from('brands')
    .update(row)
    .eq('id', id)
    .select(BRAND_SELECT)
    .single()

  if (error || !updated) throw new NotFoundError('Brand', id, { cause: error })
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

  if (error || !data) throw new NotFoundError('Brand', brandId, { cause: error })

  const snapshot = draftDataToSnapshot(data.draft_data)
  if (!snapshot) throw new ValidationError('No draft to publish')

  const partial = draftSnapshotToDomain(snapshot)
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

export async function getRelatedBrands(
  categorySlug: string,
  excludeSlug: string,
  limit = 4,
): Promise<Brand[]> {
  if (!categorySlug) return []

  const { brands } = await getBrands({
    category: [categorySlug],
    status: 'approved',
    sort: 'random',
    limit: limit + 1,
  })

  return brands.filter((brand) => brand.slug !== excludeSlug).slice(0, limit)
}

export async function getBrandCountByCategory(
  categorySlug: string,
  excludeSlug: string,
): Promise<number> {
  if (!categorySlug) return 0

  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brands')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
    .eq('product_type', categorySlug)
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

  if (error || !data) throw new NotFoundError('Brand', id, { cause: error })
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
  productPhotos: string[]
}): string[] {
  const urls = [input.heroImageUrl, ...input.productPhotos]

  return urls.filter((url): url is string => {
    if (!url) {
      return false
    }

    return !isSupabaseStorageUrl(url) && !isNonImageHost(url)
  })
}

export type ImageRef = {
  url: string
  field: 'hero' | 'photo'
  index?: number
}

export function buildSyncedImagePatch(
  refs: ImageRef[],
  storedUrls: (string | null)[],
  productPhotos: string[],
): Partial<{ heroImageUrl: string; productPhotos: string[] }> {
  const patch: Partial<{ heroImageUrl: string; productPhotos: string[] }> = {}
  const updatedPhotos = [...productPhotos]

  for (let i = 0; i < refs.length; i++) {
    const stored = storedUrls[i]
    if (stored == null) {
      continue
    }

    const ref = refs[i]
    if (ref.field === 'hero') patch.heroImageUrl = stored
    else if (ref.field === 'photo' && ref.index !== undefined) updatedPhotos[ref.index] = stored
  }

  patch.productPhotos = updatedPhotos
  return patch
}

export async function syncBrandImages(brandId: string): Promise<{ synced: number; failed: number }> {
  const brand = await getBrandById(brandId)

  const syncableUrls = collectSyncableImageUrls({
    heroImageUrl: brand.heroImageUrl,
    productPhotos: brand.productPhotos,
  })

  if (syncableUrls.length === 0) return { synced: 0, failed: 0 }

  const refs: ImageRef[] = []

  if (brand.heroImageUrl && syncableUrls.includes(brand.heroImageUrl)) {
    refs.push({ url: brand.heroImageUrl, field: 'hero' })
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
      throw new ValidationError('This brand has already been claimed', { cause: insertError })
    }
    throw insertError
  }

  const { error: updateError } = await supabase
    .from('brands')
    .update({ contact_email: email })
    .eq('id', brandId)

  if (updateError) throw updateError
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

export async function getRecentBrandCount(): Promise<{ count: number; period: '7d' | '30d' }> {
  const supabase = createServiceClient()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { count: weekCount, error: weekError } = await supabase
    .from('brands')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
    .gte('approved_at', sevenDaysAgo)

  if (weekError) throw weekError

  if ((weekCount ?? 0) > 0) {
    return { count: weekCount ?? 0, period: '7d' }
  }

  const { count: monthCount, error: monthError } = await supabase
    .from('brands')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved')
    .gte('approved_at', thirtyDaysAgo)

  if (monthError) throw monthError

  return { count: monthCount ?? 0, period: '30d' }
}

export async function getBrandStats(): Promise<{ brandCount: number; categoryCount: number }> {
  const supabase = createServiceClient()
  const [{ count, error }, { data: categoryRows, error: categoryError }] = await Promise.all([
    supabase
      .from('brands')
      .select(BRAND_COLUMNS as '*', { count: 'exact', head: true })
      .eq('status', 'approved'),
    supabase
      .from('brands')
      .select('product_type')
      .eq('status', 'approved')
      .not('product_type', 'is', null),
  ])

  if (error) throw error
  if (categoryError) throw categoryError
  const categoryCount = new Set((categoryRows ?? []).map((row) => row.product_type).filter(Boolean)).size
  return { brandCount: count ?? 0, categoryCount }
}

export async function getPopularCategories(limit = 5): Promise<{ productType: string; count: number }[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('product_type')
    .eq('status', 'approved')
    .not('is_demo', 'is', true)
    .not('product_type', 'is', null)

  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.product_type!, (counts.get(row.product_type!) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([productType, count]) => ({ productType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export async function getFeaturedBrands(
  limit = 6,
): Promise<{ id: string; name: string; slug: string; heroImageUrl: string | null; category: string }[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, hero_image_url, product_type')
    .eq('status', 'approved')
    .eq('mit_status', 'verified')
    .not('is_demo', 'is', true)
    .limit(limit * 3)

  if (error) throw error

  const rows = data ?? []
  shuffleArray(rows)

  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    heroImageUrl: row.hero_image_url,
    category: row.product_type ?? '',
  }))
}
