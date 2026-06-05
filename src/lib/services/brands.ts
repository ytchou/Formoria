import type { Brand, BrandFilters, SocialLinks } from '@/lib/types'
import type { TaxonomyTag } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'
import { unstable_cache } from 'next/cache'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { getActiveCategories } from '@/lib/services/taxonomy'
import { BRAND_SORT_CONFIG } from '@/lib/pagination'
import { RESERVED_ROUTES } from '@/middleware'
import { downloadAndStoreImages } from './image-download'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandRow = Database['public']['Tables']['brands']['Row']
type TaxonomyTagRow = Database['public']['Tables']['taxonomy_tags']['Row']

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
        isActive: t.is_active,
        suggestedBy: t.suggested_by ?? null,
        createdAt: t.created_at,
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
    isDemo: row.is_demo ?? false,
    foundingYear: row.founding_year ?? null,
    // Json columns are cast to domain types at the service boundary
    purchaseLinks: (row.purchase_links as Brand['purchaseLinks']) ?? [],
    socialLinks: mapSocialLinksToDomain((row.social_links as Record<string, string | undefined>) ?? {}),
    retailLocations: (row.retail_locations as Brand['retailLocations']) ?? [],
    productPhotos: (row.product_photos as string[]) ?? [],
    contactEmail: row.contact_email ?? null,
    brandHighlights: row.brand_highlights ?? null,
    tags,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

const BRAND_SELECT = '*, brand_taxonomy(taxonomy_tags(*)), brand_owners(user_id)'
const VERIFIED_BRAND_SELECT = '*, brand_taxonomy(taxonomy_tags(*)), brand_owners!inner(user_id)'

function formatInFilterValues(values: string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`
}

async function getOwnedBrandIds(supabase: ReturnType<typeof createServiceClient>): Promise<string[]> {
  const { data, error } = await supabase.from('brand_owners').select('brand_id')
  if (error) throw error
  return Array.from(new Set((data ?? []).map((row) => row.brand_id)))
}

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
      verificationFilter === 'verified' ? VERIFIED_BRAND_SELECT : BRAND_SELECT

    let query = supabase.from('brands').select(selectClause, { count: 'exact' }).in('id', rankedIds)

    if (verificationFilter === 'community') {
      const ownedBrandIds = await getOwnedBrandIds(supabase)
      if (ownedBrandIds.length > 0) {
        query = query.not('id', 'in', formatInFilterValues(ownedBrandIds))
      }
    }

    if (filters.status) {
      query = query.eq('status', filters.status)
    }
    if (filters.category) {
      query = query.contains('tag_slugs', [filters.category])
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
  const selectClause = verificationFilter === 'verified' ? VERIFIED_BRAND_SELECT : BRAND_SELECT

  let query = supabase.from('brands').select(selectClause, { count: 'exact' })

  if (verificationFilter === 'community') {
    const ownedBrandIds = await getOwnedBrandIds(supabase)
    if (ownedBrandIds.length > 0) {
      query = query.not('id', 'in', formatInFilterValues(ownedBrandIds))
    }
  }

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.category) {
    // brand has this category (a product_type tag slug)
    query = query.contains('tag_slugs', [filters.category])
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
  const getCachedBrandBySlug = unstable_cache(
    async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('brands')
        .select(BRAND_SELECT)
        .eq('slug', slug)
        .maybeSingle()

      if (error) throw error
      return data ? brandToDomain(data) : null
    },
    ['brand-by-slug', slug],
    { tags: [`brand:${slug}`], revalidate: 30 }
  )

  const cachedBrand = await getCachedBrandBySlug()
  if (cachedBrand) return cachedBrand

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
  data: Omit<Brand, 'id' | 'tags' | 'submittedAt' | 'approvedAt' | 'createdAt' | 'updatedAt'>
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
  const row = brandToInsert(data)
  const { data: updated, error } = await supabase
    .from('brands')
    .update(row)
    .eq('id', id)
    .select(BRAND_SELECT)
    .single()

  if (error || !updated) throw new NotFoundError('Brand', id)
  return brandToDomain(updated)
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

export async function syncBrandImages(brandId: string): Promise<void> {
  const brand = await getBrandById(brandId)

  const supabaseStorageBase = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') + '/storage/'

  type ImageRef = { url: string; field: 'hero' | 'logo' | 'photo'; index?: number }
  const refs: ImageRef[] = []

  if (brand.heroImageUrl && !brand.heroImageUrl.includes(supabaseStorageBase)) {
    refs.push({ url: brand.heroImageUrl, field: 'hero' })
  }
  if (brand.logoUrl && !brand.logoUrl.includes(supabaseStorageBase)) {
    refs.push({ url: brand.logoUrl, field: 'logo' })
  }
  for (let i = 0; i < brand.productPhotos.length; i++) {
    const url = brand.productPhotos[i]
    if (url && !url.includes(supabaseStorageBase)) {
      refs.push({ url, field: 'photo', index: i })
    }
  }

  if (refs.length === 0) return

  const externalUrls = refs.map((r) => r.url)
  const storedUrls = await downloadAndStoreImages(externalUrls, brandId)

  const patch: Partial<{ heroImageUrl: string; logoUrl: string; productPhotos: string[] }> = {}
  const updatedPhotos = [...brand.productPhotos]

  // Best-effort positional match: consume stored URLs in input order
  for (let i = 0; i < storedUrls.length; i++) {
    const stored = storedUrls[i]
    const ref = refs[i]
    if (ref.field === 'hero') patch.heroImageUrl = stored
    else if (ref.field === 'logo') patch.logoUrl = stored
    else if (ref.field === 'photo' && ref.index !== undefined) updatedPhotos[ref.index] = stored
  }

  patch.productPhotos = updatedPhotos
  await updateBrand(brandId, patch)
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
