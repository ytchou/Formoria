import { deleteStoredImagePaths } from './image-upload'

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
  alt_zh?: string | null
  alt_en?: string | null
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
  in: (
    column: 'url',
    values: string[],
  ) => Promise<{ data: BrandImageRow[] | null; error: QueryError | null }>
  order: (
    column: 'sort_order',
    options: { ascending: boolean },
  ) => Promise<{ data: BrandImageRow[] | null; error: QueryError | null }>
}
type BrandImagesTable = {
  select: (columns: string) => BrandImagesSelectQuery
  insert: (row: BrandImageInsert) => Promise<{ error: QueryError | null }>
  upsert: (
    row: BrandImageInsert,
    options: { onConflict: string },
  ) => Promise<{ error: QueryError | null }>
  update: (row: Partial<BrandImageInsert>) => {
    eq: (
      column: 'brand_id',
      value: string,
    ) => {
      in: (
        column: 'url',
        values: string[],
      ) => Promise<{ error: QueryError | null }>
    }
  }
}
type BrandImagesClient = {
  from: (table: 'brand_images') => BrandImagesTable
}
type BrandHeroTable = {
  update: (row: { hero_image_url: string | null }) => {
    eq: (
      column: 'id',
      value: string,
    ) => Promise<{ error: QueryError | null }>
  }
}
type BrandHeroClient = {
  from: (table: 'brands') => BrandHeroTable
}

function brandImagesTable(supabase: unknown): BrandImagesTable {
  return (supabase as BrandImagesClient).from('brand_images')
}

function brandHeroTable(supabase: unknown): BrandHeroTable {
  return (supabase as BrandHeroClient).from('brands')
}

export function toImageFields(rows: BrandImageRow[]): {
  heroImageUrl: string | null
  productPhotos: string[]
  imageAlts: Array<{ altZh: string | null; altEn: string | null }>
} {
  const active = rows
    .filter((row) => row.status === 'active')
    .toSorted((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))

  const hero = active.at(0)

  return {
    heroImageUrl: hero?.url ?? null,
    productPhotos: active.slice(1).map((row) => row.url),
    imageAlts: active.map((row) => ({ altZh: row.alt_zh ?? null, altEn: row.alt_en ?? null })),
  }
}

export async function getBrandImages(
  supabase: unknown,
  brandId: string,
): Promise<BrandImageRow[]> {
  const { data, error } = await brandImagesTable(supabase)
    .select('url, status, tags, score, sort_order, source_url, alt_zh, alt_en')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  if (error) {
    if (error.code === 'PGRST205') return []
    throw error
  }
  return data ?? []
}

export async function insertBrandImage(
  supabase: unknown,
  data: BrandImageInsert,
): Promise<void> {
  const row: BrandImageInsert = {
    status: 'active',
    sort_order: 0,
    ...data,
  }

  const { error } = data.source_url
    ? await brandImagesTable(supabase).upsert(row, {
        onConflict: 'brand_id,source_url',
      })
    : await brandImagesTable(supabase).insert(row)

  if (error && error.code !== '23505') throw error
}

export async function rejectBrandImages(
  supabase: unknown,
  brandId: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) return

  const { data: rows, error: selectError } = await brandImagesTable(supabase)
    .select('storage_path')
    .eq('brand_id', brandId)
    .in('url', urls)
  if (selectError) throw selectError

  const storagePaths = (rows ?? []).flatMap((row) =>
    row.storage_path ? [row.storage_path] : [],
  )
  if (storagePaths.length > 0) {
    try {
      await deleteStoredImagePaths(storagePaths)
    } catch (storageError) {
      console.error(
        `[rejectBrandImages] Failed to delete rejected images for ${brandId}:`,
        storageError,
      )
    }
  }

  const { error } = await brandImagesTable(supabase)
    .update({ status: 'rejected', storage_path: null })
    .eq('brand_id', brandId)
    .in('url', urls)
  if (error) throw error
}

export async function syncHeroDenormalized(
  supabase: unknown,
  brandId: string,
): Promise<void> {
  const images = await getBrandImages(supabase, brandId)
  const heroImageUrl = images.at(0)?.url ?? null

  // brand_images owns image ordering; hero_image_url is only its grid-card projection.
  const { error } = await brandHeroTable(supabase)
    .update({ hero_image_url: heroImageUrl })
    .eq('id', brandId)

  if (error) throw error
}
