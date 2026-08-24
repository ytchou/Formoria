import { auditedCall } from '@/lib/audit'
import {
  imagePathToUrl,
  storagePathFromImageUrl,
} from '@/lib/images/image-url'
import { isLogoImageTags } from '@/lib/constants/brand-images'
import type { BrandImageMeta } from '@/lib/types/brand'
import { deleteStoredImagePaths } from './image-upload'
import { isBrandOwnedStoragePath } from '@/lib/images/storage-keys'

type BrandImageStatus = 'active' | 'candidate' | 'rejected'
type BrandImageSource = 'scrape' | 'google_image' | 'owner' | 'admin' | 'legacy' | 'json_ld'
type BrandImageProviderMetadata = Record<string, string | number | null | undefined>

export type BrandImageRow = {
  id?: string
  brand_id?: string
  storage_path?: string | null
  /** Legacy public URL. Read-only: still selected by admin projections, never written. */
  url?: string | null
  source?: BrandImageSource
  status?: BrandImageStatus
  tags?: string[] | null
  score?: number | string | null
  sort_order?: number
  source_url?: string | null
  provider_metadata?: BrandImageProviderMetadata | null
  rejection_reasons?: string[] | null
  rejected_at?: string | null
  width?: number | null
  height?: number | null
}

export type BrandImageInsert = {
  brand_id: string
  /**
   * DEV-1551 task 12: the bucket key is the ONLY reference written. The `url`
   * column stays in the schema (seven Postgres functions read it, two of them
   * hand-patched with no source file) but nothing in TypeScript writes it any
   * more.
   */
  storage_path: string
  source: BrandImageSource
  source_url?: string | null
  provider_metadata?: BrandImageProviderMetadata | null
  status?: BrandImageStatus
  rejection_reasons?: string[] | null
  rejected_at?: string | null
  tags?: string[] | null
  score?: number | null
  sort_order?: number
}

/**
 * Update payloads may CLEAR `storage_path` (rejection drops the bucket
 * reference), which `Partial<BrandImageInsert>` cannot express because the
 * insert contract requires a key. No update writes `url` — that column stays
 * unwritten.
 */
type BrandImageUpdate = Partial<Omit<BrandImageInsert, 'storage_path'>> & {
  storage_path?: string | null
}

type QueryError = { code?: string; message?: string }
type BrandImagesSelectQuery = {
  eq: (
    column: 'brand_id' | 'status' | 'source_url',
    value: string,
  ) => BrandImagesSelectQuery
  in: (
    column: 'storage_path',
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
  update: (row: BrandImageUpdate) => {
    eq: (
      column: 'brand_id',
      value: string,
    ) => {
      in: (
        column: 'storage_path',
        values: string[],
      ) => Promise<{ error: QueryError | null }>
    }
  }
}
type BrandImagesClient = {
  from: (table: 'brand_images') => BrandImagesTable
}
type BrandHeroTable = {
  update: (row: { hero_image_storage_path: string | null }) => {
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
 * decides fill mode (`isLogo`), so a shift visibly letterboxes a product photo
 * and crops a logo. Callers that render metadata alongside the image MUST index
 * by `sourceIndex`, never by array position — the same `sourceIndex` discipline
 * `image-carousel.tsx` uses for its own host-filter drop.
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
    width: number | null
    height: number | null
  } | null
  productPhotos: string[]
  imageAlts: BrandImageMeta[]
} {
  const active = rows
    // A row with no `storage_path` has no renderable form at all now that the
    // bucket is private (DEV-1551), so it is dropped here rather than emitted
    // as a broken `src`. Dropping it BEFORE the sort keeps `imageAlts`
    // index-aligned with `[heroImageUrl, ...productPhotos]`.
    .filter((row) => row.status === 'active' && Boolean(row.storage_path))
    .toSorted((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))

  const hero = active.at(0)

  return {
    heroImageUrl: imagePathToUrl(hero?.storage_path),
    heroImageMetadata: hero
      ? {
          width: hero.width && hero.width > 0 ? hero.width : null,
          height: hero.height && hero.height > 0 ? hero.height : null,
        }
      : null,
    productPhotos: active
      .slice(1)
      .flatMap((row) => {
        const src = imagePathToUrl(row.storage_path)
        return src ? [src] : []
      }),
    imageAlts: active.map((row) => ({
      isLogo: isLogoImageTags(row.tags),
      /*
       * The brand-supplied credit, derived once and never inferred.
       *
       * `'owner'` is written by `syncOwnerUploadedImages()` when a brand owner
       * uploads through the dashboard wizard. Every other value — 'scrape',
       * 'google_image', 'admin', 'legacy', 'json_ld' — is Formoria or a
       * crawler, so they are NOT enumerated here: an equality test against the
       * one value that grants the credit makes a new source added upstream fail
       * closed rather than silently inherit it.
       */
      isOwnerSupplied: row.source === 'owner',
    })),
  }
}

export async function getBrandImages(
  supabase: unknown,
  brandId: string,
): Promise<BrandImageRow[]> {
  const { data, error } = await brandImagesTable(supabase)
    // `source` is in the projection for the brand-supplied credit. The client is
    // untyped, so dropping it here is neither a type error nor a query error —
    // every row would just come back unattributed and the credit would silently
    // never render. `brand-images.test.ts` asserts this string for that reason.
    .select(
      'storage_path, status, tags, score, sort_order, source, source_url, width, height',
    )
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

/**
 * Turns whatever the UI handed back into bucket keys.
 *
 * Callers hold the RENDERED reference — since DEV-1551 that is `/i/<key>`.
 * Anything else (a third-party URL an owner pasted, a legacy public storage
 * URL) resolves to no key and is silently skipped, which is the safe direction:
 * these functions delete storage objects.
 */
function storagePathsFromImageRefs(refs: readonly string[]): string[] {
  return [
    ...new Set(
      refs.flatMap((ref) => {
        const path = storagePathFromImageUrl(ref)
        return path ? [path] : []
      }),
    ),
  ]
}

export async function rejectBrandImages(
  supabase: unknown,
  brandId: string,
  imageRefs: string[],
): Promise<void> {
  if (imageRefs.length === 0) return
  const storagePaths = storagePathsFromImageRefs(imageRefs)
  if (storagePaths.length === 0) return

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
    .in('storage_path', storagePaths)
  if (selectError) throw selectError

  const storedPaths = (rows ?? []).flatMap((row) =>
    row.storage_path ? [row.storage_path] : [],
  )
  if (storedPaths.length > 0) {
    try {
      await deleteStoredImagePaths(storedPaths)
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
    .in('storage_path', storagePaths)
  if (error) throw error
    },
    { subjectId: brandId, summary: { urlCount: imageRefs.length } },
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
  imageRefs: string[],
): Promise<void> {
  if (imageRefs.length === 0) return
  const storagePaths = storagePathsFromImageRefs(imageRefs)
  if (storagePaths.length === 0) return

  return auditedCall(
    {
      provider: 'images',
      operation: 'releaseBrandImageUrls',
      kind: 'service',
    },
    async () => {
  const { data: rows, error } = await brandImagesTable(supabase)
    .select('storage_path')
    .eq('brand_id', brandId)
    .in('storage_path', storagePaths)
  if (error) throw error

  const referencedPaths = new Set(
    (rows ?? []).flatMap((row) => (row.storage_path ? [row.storage_path] : [])),
  )
  const unreferencedPaths = storagePaths.filter(
    (path) => !referencedPaths.has(path),
  )

  await rejectBrandImages(
    supabase,
    brandId,
    storagePaths
      .filter((path) => referencedPaths.has(path))
      .flatMap((path) => {
        const ref = imagePathToUrl(path)
        return ref ? [ref] : []
      }),
  )

  // The prefix gate is stated HERE, not left to `deleteStoredImagePaths`, which
  // also accepts `submissions/` and `curated-products/`. This is owner-driven
  // cleanup: any ref the owner UI hands back that resolves outside `brands/` is
  // an object some other flow owns, and deleting it would break a live
  // reference that this function can neither see nor repair. Skipping is the
  // safe direction — the storage purge reclaims a genuine orphan later.
  const deletablePaths = unreferencedPaths.filter(isBrandOwnedStoragePath)

  if (deletablePaths.length > 0) {
    try {
      await deleteStoredImagePaths(deletablePaths)
    } catch (storageError) {
      console.error(
        `[releaseBrandImageUrls] Failed to delete unreferenced images for ${brandId}:`,
        storageError,
      )
    }
  }
    },
    { subjectId: brandId, summary: { urlCount: imageRefs.length } },
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
  const heroStoragePath = images.at(0)?.storage_path ?? null

  // brand_images owns image ordering; the denormalized hero column is only its
  // grid-card projection. Since DEV-1551 task 12 that column is
  // `hero_image_storage_path`; `hero_image_url` is left exactly as the SQL
  // functions last wrote it and is no longer read by any TypeScript projection.
  const { error } = await brandHeroTable(supabase)
    .update({ hero_image_storage_path: heroStoragePath })
    .eq('id', brandId)

  if (error) throw error
    },
    { subjectId: brandId },
  )
}
