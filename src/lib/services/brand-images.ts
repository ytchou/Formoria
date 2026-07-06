type BrandImageStatus = 'active' | 'rejected'
type BrandImageSource = 'scrape' | 'google_image' | 'owner' | 'admin' | 'legacy'

export type BrandImageRow = {
  id?: string
  brand_id?: string
  storage_path?: string | null
  url: string
  source?: BrandImageSource
  status?: BrandImageStatus
  tags?: string[] | null
  score?: number | string | null
  sort_order?: number
  source_url?: string | null
}

export type BrandImageInsert = {
  brand_id: string
  url: string
  source: BrandImageSource
  source_url?: string | null
  storage_path?: string | null
  status?: BrandImageStatus
  tags?: string[] | null
  score?: number | null
  sort_order?: number
}

type QueryError = { code?: string; message?: string }
type BrandImagesSelectQuery = {
  eq: (column: 'brand_id' | 'status', value: string) => BrandImagesSelectQuery
  order: (
    column: 'sort_order',
    options: { ascending: boolean }
  ) => Promise<{ data: BrandImageRow[] | null; error: QueryError | null }>
}
type BrandImagesTable = {
  select: (columns: string) => BrandImagesSelectQuery
  insert: (row: BrandImageInsert) => Promise<{ error: QueryError | null }>
  upsert: (
    row: BrandImageInsert,
    options: { onConflict: string }
  ) => Promise<{ error: QueryError | null }>
}
type BrandImagesClient = {
  from: (table: 'brand_images') => BrandImagesTable
}

const HERO_TAGS = new Set(['product', 'lifestyle', 'packaging'])
const REJECTED_HERO_TAGS = new Set(['promo', 'text_banner', 'irrelevant', 'logo'])

function brandImagesTable(supabase: unknown): BrandImagesTable {
  return (supabase as BrandImagesClient).from('brand_images')
}

function hasAnyTag(row: Pick<BrandImageRow, 'tags'>, tags: Set<string>): boolean {
  return (row.tags ?? []).some((tag) => tags.has(tag))
}

function scoreValue(row: Pick<BrandImageRow, 'score'>): number {
  if (typeof row.score === 'number') return row.score
  if (typeof row.score === 'string') return Number(row.score)
  return 0
}

export function toImageFields(
  rows: BrandImageRow[]
): { heroImageUrl: string | null; productPhotos: string[] } {
  const active = rows
    .filter((row) => row.status === 'active')
    .toSorted((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))

  const hero = active.at(0)

  return {
    heroImageUrl: hero?.url ?? null,
    productPhotos: active.slice(1).map((row) => row.url),
  }
}

export function pickHero(candidates: BrandImageRow[]): BrandImageRow | null {
  const eligible = candidates
    .filter((row) => row.status === undefined || row.status === 'active')
    .filter((row) => hasAnyTag(row, HERO_TAGS))
    .filter((row) => !hasAnyTag(row, REJECTED_HERO_TAGS))
    .toSorted((left, right) => {
      const scoreDiff = scoreValue(right) - scoreValue(left)
      if (scoreDiff !== 0) return scoreDiff
      return (left.sort_order ?? 0) - (right.sort_order ?? 0)
    })

  return eligible.at(0) ?? null
}

export async function getBrandImages(
  supabase: unknown,
  brandId: string
): Promise<BrandImageRow[]> {
  const { data, error } = await brandImagesTable(supabase)
    .select('url, status, tags, score, sort_order, source_url')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function insertBrandImage(
  supabase: unknown,
  data: BrandImageInsert
): Promise<void> {
  const row: BrandImageInsert = {
    status: 'active',
    sort_order: 0,
    ...data,
  }

  const { error } = data.source_url
    ? await brandImagesTable(supabase).upsert(row, { onConflict: 'brand_id,source_url' })
    : await brandImagesTable(supabase).insert(row)

  if (error && error.code !== '23505') throw error
}

export async function syncHeroDenormalized(
  supabase: unknown,
  brandId: string
): Promise<void> {
  const images = await getBrandImages(supabase, brandId)
  const hero = pickHero(images) ?? images.at(0)

  if (!hero) return

  const { updateBrand } = await import('./brands')
  await updateBrand(brandId, { heroImageUrl: hero.url }, { source: 'enriched' })
}
