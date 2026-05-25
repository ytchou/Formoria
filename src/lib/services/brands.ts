import type { Brand, BrandFilters, SocialLinks } from '@/lib/types'
import type { TaxonomyTag } from '@/lib/types'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { BRAND_SORT_CONFIG } from '@/lib/pagination'
import { RESERVED_ROUTES } from '@/middleware'
import { downloadAndStoreImages } from './image-download'

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

/* eslint-disable @typescript-eslint/no-explicit-any */
export function brandToDomain(row: any): Brand {
  const taxonomyJoin: any[] = row.brand_taxonomy ?? []
  const tags: TaxonomyTag[] = taxonomyJoin
    .filter((bt: any) => bt.taxonomy_tags)
    .map((bt: any) => {
      const t = bt.taxonomy_tags
      return {
        id: t.id,
        name: t.name,
        nameZh: t.name_zh ?? null,
        slug: t.slug,
        category: t.category,
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
    status: row.status,
    category: row.category ?? null,
    isVerified: Array.isArray(row.brand_owners) && row.brand_owners.length > 0,
    foundingYear: row.founding_year ?? null,
    purchaseLinks: row.purchase_links ?? [],
    socialLinks: mapSocialLinksToDomain(row.social_links ?? {}),
    retailLocations: row.retail_locations ?? [],
    productPhotos: row.product_photos ?? [],
    contactEmail: row.contact_email ?? null,
    founder: row.founder
      ? {
          name: row.founder.name,
          title: row.founder.title ?? null,
          avatarUrl: row.founder.avatar_url ?? null,
          quote: row.founder.quote ?? null,
        }
      : null,
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
  if (data.founder !== undefined) {
    row.founder = data.founder
      ? { name: data.founder.name, title: data.founder.title, avatar_url: data.founder.avatarUrl, quote: data.founder.quote }
      : null
  }
  if (data.brandHighlights != null) row.brand_highlights = data.brandHighlights
  return row
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

const BRAND_SELECT = '*, brand_taxonomy(taxonomy_tags(*)), brand_owners(user_id)'

export async function getBrands(
  filters?: BrandFilters
): Promise<{ brands: Brand[]; totalCount: number }> {
  const supabase = createServiceClient()

  // When filtering by tags, use !inner join so only matching brands are returned
  const select =
    filters?.tags && filters.tags.length > 0
      ? '*, brand_taxonomy!inner(taxonomy_tags!inner(*))'
      : BRAND_SELECT

  let query = supabase.from('brands').select(select, { count: 'exact' })

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.category) {
    query = query.eq('category', filters.category)
  }
  if (filters?.search) {
    const term = filters.search.slice(0, 100).replace(/[%_\\]/g, '\\$&')
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
  }
  if (filters?.tags && filters.tags.length > 0) {
    query = query.in('brand_taxonomy.taxonomy_tags.slug', filters.tags)
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
    .single()

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
