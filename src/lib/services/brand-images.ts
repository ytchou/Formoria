import { auditedCall } from '@/lib/audit'
import { isLogoImageTags } from '@/lib/constants/brand-images'
import type { BrandImageMeta } from '@/lib/types/brand'
import { deleteBrandImages, deleteStoredImagePaths } from './image-upload'

type BrandImageStatus = 'active' | 'candidate' | 'rejected'
type BrandImageSource = 'scrape' | 'google_image' | 'owner' | 'admin' | 'legacy' | 'json_ld'
export type BrandImageProviderMetadata = Record<string, string | number | null | undefined>

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
  provider_metadata?: BrandImageProviderMetadata | null
  rejection_reasons?: string[] | null
  rejected_at?: string | null
  alt_zh?: string | null
  alt_en?: string | null
  width?: number | null
  height?: number | null
  focal_x?: number | null
  focal_y?: number | null
}

export type BrandImageInsert = {
  brand_id: string
  url: string
  source: BrandImageSource
  source_url?: string | null
  provider_metadata?: BrandImageProviderMetadata | null
  storage_path?: string | null
  status?: BrandImageStatus
  rejection_reasons?: string[] | null
  rejected_at?: string | null
  tags?: string[] | null
  score?: number | null
  sort_order?: number
  focal_x?: number | null
  focal_y?: number | null
}

type QueryError = { code?: string; message?: string }
type BrandImagesSelectQuery = {
  eq: (
    column: 'brand_id' | 'status' | 'source_url',
    value: string,
  ) => BrandImagesSelectQuery
  in: (
    column: 'url',
    values: string[],
  ) => Promise<{ data: BrandImageRow[] | null; error: QueryError | null }>
  order: (
    column: 'sort_order',
    options: { ascending: boolean },
  ) => Promise<{ data: BrandImageRow[] | null; error: QueryError | null }>
  maybeSingle: () => Promise<{
    data: BrandImageRow | null
    error: QueryError | null
  }>
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

/**
 * Gallery URLs paired with their index in the UNFILTERED
 * `[heroImageUrl, ...productPhotos]` sequence.
 *
 * The pairing is load-bearing, not a convenience. `imageAlts` is built by
 * `toImageFields` as `active.map(...)` over that same unfiltered sequence, so a
 * brand with a null `heroImageUrl` shifts every later gallery position by one
 * against its metadata. That used to mis-assign only alt text; it now also
 * decides fill mode (`isLogo`) and `object-position`, so a shift visibly
 * letterboxes a product photo and crops a logo. Callers that render metadata
 * alongside the image MUST index by `sourceIndex`, never by array position —
 * the same `sourceIndex` discipline `image-carousel.tsx` uses for its own
 * host-filter drop.
 */
export function getBrandGalleryImageEntries(brand: {
  heroImageUrl: string | null
  productPhotos: readonly string[]
}): Array<{ url: string; sourceIndex: number }> {
  return [brand.heroImageUrl, ...brand.productPhotos].flatMap((url, sourceIndex) =>
    url ? [{ url, sourceIndex }] : [],
  )
}

/** URL-only view of {@link getBrandGalleryImageEntries}, for callers with no per-image metadata. */
export function getBrandGalleryImages(brand: {
  heroImageUrl: string | null
  productPhotos: readonly string[]
}): string[] {
  return getBrandGalleryImageEntries(brand).map((entry) => entry.url)
}

export function toImageFields(rows: BrandImageRow[]): {
  heroImageUrl: string | null
  heroImageMetadata: {
    altZh: string | null
    altEn: string | null
    width: number | null
    height: number | null
  } | null
  productPhotos: string[]
  imageAlts: BrandImageMeta[]
} {
  const active = rows
    .filter((row) => row.status === 'active')
    .toSorted((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))

  const hero = active.at(0)

  return {
    heroImageUrl: hero?.url ?? null,
    heroImageMetadata: hero
      ? {
          altZh: hero.alt_zh ?? null,
          altEn: hero.alt_en ?? null,
          width: hero.width && hero.width > 0 ? hero.width : null,
          height: hero.height && hero.height > 0 ? hero.height : null,
        }
      : null,
    productPhotos: active.slice(1).map((row) => row.url),
    imageAlts: active.map((row) => ({
      altZh: row.alt_zh ?? null,
      altEn: row.alt_en ?? null,
      isLogo: isLogoImageTags(row.tags),
      focalX: row.focal_x ?? null,
      focalY: row.focal_y ?? null,
    })),
  }
}

export async function getBrandImages(
  supabase: unknown,
  brandId: string,
): Promise<BrandImageRow[]> {
  const { data, error } = await brandImagesTable(supabase)
    .select('url, status, tags, score, sort_order, source_url, alt_zh, alt_en, width, height, focal_x, focal_y')
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
  return auditedCall(
    {
      provider: 'images',
      operation: 'insertBrandImage',
      kind: 'service',
    },
    async () => {
  const row: BrandImageInsert = {
    status: 'active',
    sort_order: 0,
    ...data,
  }

  if (data.source_url && data.source !== 'owner') {
    // A rejection is sticky. The classifier's verdict is about the CONTENT at
    // this source_url, and re-downloading the same url yields the same content,
    // so re-inserting it must be a no-op. Without this guard the upsert below
    // merges only the payload's columns: it flips the rejected row back to
    // active with a fresh storage_path while leaving its stale junk tags/score
    // in place, and getUnclassifiedImages (`.is('tags', null)`) then never
    // re-examines it. Nulling tags/score on upsert instead would re-classify
    // every re-downloaded image on every enrichment run and burn LLM budget.
    //
    // `source: 'owner'` is exempt because that stickiness argument only holds
    // for automated re-downloads. An owner re-adding a photo from the dashboard
    // is deliberate human intent aimed at THIS image, and human intent outranks
    // the classifier: swallowing it would make the dashboard silently no-op with
    // no way for the owner to ever get the photo back. The re-add resurrects the
    // row (status flips back to active), and the stale tags are acceptable here
    // because an owner-curated image is not a classification candidate.
    const { data: existing, error: lookupError } = await brandImagesTable(supabase)
      .select('status')
      .eq('brand_id', data.brand_id)
      .eq('source_url', data.source_url)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing?.status === 'rejected') return
  }

  const { error } = data.source_url
    ? await brandImagesTable(supabase).upsert(row, {
        onConflict: 'brand_id,source_url',
      })
    : await brandImagesTable(supabase).insert(row)

  if (error && error.code !== '23505') throw error
    },
    { subjectId: data.brand_id, summary: { source: data.source } },
  )
}

export async function rejectBrandImages(
  supabase: unknown,
  brandId: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) return

  return auditedCall(
    {
      provider: 'images',
      operation: 'rejectBrandImages',
      kind: 'service',
    },
    async () => {
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
    },
    { subjectId: brandId, summary: { urlCount: urls.length } },
  )
}

/**
 * Releases image URLs that dropped out of a brand's image list.
 *
 * Invariant: never delete a storage object that a live `brand_images` row still
 * references. Leaking an unreferenced object is harmless (the storage purge
 * reclaims it later); deleting a referenced one leaves a permanently broken
 * image. So urls backed by a row go through `rejectBrandImages`, which updates
 * the row and its storage object as a pair, and only urls with no row at all
 * are deleted straight from storage.
 */
export async function releaseBrandImageUrls(
  supabase: unknown,
  brandId: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) return

  return auditedCall(
    {
      provider: 'images',
      operation: 'releaseBrandImageUrls',
      kind: 'service',
    },
    async () => {
  const { data: rows, error } = await brandImagesTable(supabase)
    .select('url, storage_path')
    .eq('brand_id', brandId)
    .in('url', urls)
  if (error) throw error

  const referencedUrls = new Set((rows ?? []).map((row) => row.url))
  const unreferencedUrls = urls.filter((url) => !referencedUrls.has(url))

  await rejectBrandImages(
    supabase,
    brandId,
    urls.filter((url) => referencedUrls.has(url)),
  )

  if (unreferencedUrls.length > 0) {
    try {
      await deleteBrandImages(unreferencedUrls)
    } catch (storageError) {
      console.error(
        `[releaseBrandImageUrls] Failed to delete unreferenced images for ${brandId}:`,
        storageError,
      )
    }
  }
    },
    { subjectId: brandId, summary: { urlCount: urls.length } },
  )
}

export async function syncHeroDenormalized(
  supabase: unknown,
  brandId: string,
): Promise<void> {
  return auditedCall(
    {
      provider: 'images',
      operation: 'syncHeroDenormalized',
      kind: 'service',
    },
    async () => {
  const images = await getBrandImages(supabase, brandId)
  const heroImageUrl = images.at(0)?.url ?? null

  // brand_images owns image ordering; hero_image_url is only its grid-card projection.
  const { error } = await brandHeroTable(supabase)
    .update({ hero_image_url: heroImageUrl })
    .eq('id', brandId)

  if (error) throw error
    },
    { subjectId: brandId },
  )
}
