import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getBrandGalleryImageEntries,
  getBrandGalleryImages,
  getBrandImages,
  insertBrandImage,
  rejectBrandImages,
  releaseBrandImageUrls,
  toImageFields,
} from './brand-images'

const { storageRemoveMock } = vi.hoisted(() => ({
  storageRemoveMock: vi.fn(),
}))

// Only the storage delete is a spy. The `brands/`-only gate lives in
// `@/lib/images/storage-keys`, which is not mocked, so the test exercises the
// real predicate.
vi.mock('./image-upload', () => ({
  deleteStoredImagePaths: storageRemoveMock,
}))

/**
 * DEV-1551: callers hand these functions the RENDERED reference, which is
 * `/i/<key>`, and the lookups key on `storage_path`.
 */
const HERO_KEY = 'brands/brand-1/a.jpg'
const HERO_REF = `/i/${HERO_KEY}`
const ORPHAN_KEY = 'brands/brand-1/orphan.jpg'
const ORPHAN_REF = `/i/${ORPHAN_KEY}`

function createRejectClient(images: unknown[]) {
  const selectIn = vi.fn().mockResolvedValue({ data: images, error: null })
  const selectEq = vi.fn(() => ({ in: selectIn }))
  const select = vi.fn(() => ({ eq: selectEq }))
  const updateIn = vi.fn().mockResolvedValue({ error: null })
  const updateEq = vi.fn(() => ({ in: updateIn }))
  const update = vi.fn(() => ({ eq: updateEq }))
  const deleteRow = vi.fn()
  const from = vi.fn(() => ({ select, update, delete: deleteRow }))

  return { client: { from }, deleteRow, select, update, updateIn }
}

type StatusRow = { storage_path: string | null; status: string }

/**
 * Like createRejectClient, but the select chain honours an optional
 * .eq('status', …) filter. Used to prove that the lookup in
 * releaseBrandImageUrls stays status-agnostic.
 */
function createStatusFilteringClient(images: StatusRow[]) {
  const selectIn = vi.fn().mockResolvedValue({ data: images, error: null })
  const statusEq = vi.fn((_column: string, value: string) => ({
    in: vi
      .fn()
      .mockResolvedValue({
        data: images.filter((image) => image.status === value),
        error: null,
      }),
  }))
  const selectEq = vi.fn(() => ({ in: selectIn, eq: statusEq }))
  const select = vi.fn(() => ({ eq: selectEq }))
  const updateIn = vi.fn().mockResolvedValue({ error: null })
  const updateEq = vi.fn(() => ({ in: updateIn }))
  const update = vi.fn(() => ({ eq: updateEq }))
  const deleteRow = vi.fn()
  const from = vi.fn(() => ({ select, update, delete: deleteRow }))

  return { client: { from }, deleteRow, select, update, updateIn }
}

/**
 * Client for insertBrandImage: the (brand_id, source_url) lookup resolves to
 * `existing`, and insert/upsert are spies so a suppressed write is observable.
 */
function createInsertClient(existing: { status: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
  const sourceUrlEq = vi.fn(() => ({ maybeSingle }))
  const brandIdEq = vi.fn(() => ({ eq: sourceUrlEq }))
  const select = vi.fn(() => ({ eq: brandIdEq }))
  const insert = vi.fn().mockResolvedValue({ error: null })
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn(() => ({ select, insert, upsert }))

  return { client: { from }, select, insert, upsert }
}

describe('insertBrandImage', () => {
  const data = {
    brand_id: 'brand-1',
    storage_path: 'brands/brand-1/a.jpg',
    source: 'scrape' as const,
    source_url: 'https://example.com/a.jpg',
  }

  it('refuses to resurrect a row the classifier already rejected', async () => {
    // The bug this guards: the upsert merges only the payload's columns, so a
    // re-download would flip the row back to active while keeping its junk tags
    // — and `.is('tags', null)` means it is never re-classified.
    const { client, upsert, insert } = createInsertClient({ status: 'rejected' })

    await insertBrandImage(client, data)

    expect(upsert).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  // Human intent outranks the classifier: an owner re-adding a photo through
  // the dashboard must resurrect the row, not silently no-op.
  it('lets an owner re-add resurrect a rejected row', async () => {
    const { client, upsert } = createInsertClient({ status: 'rejected' })

    await insertBrandImage(client, { ...data, source: 'owner' })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', source: 'owner' }),
      { onConflict: 'brand_id,source_url' },
    )
  })

  it('still refuses to resurrect a rejected row for a non-owner source', async () => {
    const { client, upsert, insert } = createInsertClient({ status: 'rejected' })

    await insertBrandImage(client, { ...data, source: 'google_image' })

    expect(upsert).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('upserts when the existing row is active', async () => {
    const { client, upsert } = createInsertClient({ status: 'active' })

    await insertBrandImage(client, data)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', sort_order: 0, ...data }),
      { onConflict: 'brand_id,source_url' },
    )
  })

  it('upserts when no row exists for the pair', async () => {
    const { client, upsert } = createInsertClient(null)

    await insertBrandImage(client, data)

    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('takes the plain insert path without a lookup when source_url is absent', async () => {
    const { client, select, insert, upsert } = createInsertClient(null)

    await insertBrandImage(client, {
      brand_id: 'brand-1',
      storage_path: 'brands/brand-1/a.jpg',
      source: 'owner',
    })

    expect(select).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
  })
})

/**
 * Client for getBrandImages: records the projection and the filters, and
 * replays a fixed row set so the mapper's inputs are observable.
 */
function createReadClient(rows: unknown[]) {
  const call = { select: '', eqFilters: [] as Array<[string, string]>, order: null as unknown }
  const builder = {
    select(columns: string) {
      call.select = columns
      return builder
    },
    eq(column: string, value: string) {
      call.eqFilters.push([column, value])
      return builder
    },
    order(column: string, options: unknown) {
      call.order = [column, options]
      return Promise.resolve({ data: rows, error: null })
    },
  }
  const from = vi.fn(() => builder)
  return { client: { from }, call, from }
}

describe('getBrandImages', () => {
  it('pins an explicit column list matching the row type, active rows only', async () => {
    // What this pins is the explicit list, not a minimal one: `score` and
    // `source_url` are part of `BrandImageRow` and are projected for it, and no
    // current caller reads either. The list must stay in sync with that type.
    //
    // Neither this query nor `toImageFields` is type-checked against the
    // database: `getBrandImages` takes an `unknown` client and the service
    // client carries no `<Database>` generic. A column named here that no
    // longer exists passes tsc and lint and fails at runtime with a 42703, so
    // the projection is pinned rather than inferred.
    const { client, call } = createReadClient([])

    await getBrandImages(client, 'brand-1')

    const columns = call.select.split(',').map((column) => column.trim())
    expect(columns).toEqual([
      'storage_path',
      'status',
      'tags',
      'score',
      'sort_order',
      'source',
      'source_url',
      'width',
      'height',
    ])
    expect(call.eqFilters).toEqual([
      ['brand_id', 'brand-1'],
      ['status', 'active'],
    ])
    expect(call.order).toEqual(['sort_order', { ascending: true }])
  })

  it('treats a missing table as no images rather than an error', async () => {
    // PGRST205 is "relation not found" — the pre-migration state. Every other
    // error still throws, because a silent empty gallery would hide a real
    // read failure behind a brand that merely looks image-less.
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: null, error: { code: 'PGRST205' } }),
    }

    await expect(getBrandImages({ from: () => builder }, 'brand-1')).resolves.toEqual([])
  })

  it('rethrows any other read failure', async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: null, error: { code: '42703', message: 'boom' } }),
    }

    await expect(getBrandImages({ from: () => builder }, 'brand-1')).rejects.toMatchObject({
      code: '42703',
    })
  })
})

describe('toImageFields', () => {
  const rows = [
    { storage_path: 'brands/brand-1/rejected-campaign.webp', status: 'rejected', sort_order: 0 },
    {
      storage_path: 'brands/brand-1/tote.webp',
      status: 'active',
      sort_order: 0,
      width: 1600,
      height: 1200,
    },
    { storage_path: 'brands/brand-1/workshop.webp', status: 'active', sort_order: 1 },
  ]

  it('keeps stored hero metadata aligned with the selected active image', () => {
    expect(toImageFields(rows as never)).toEqual({
      heroImageUrl: '/i/brands/brand-1/tote.webp',
      heroImageMetadata: {
        width: 1600,
        height: 1200,
      },
      productPhotos: ['/i/brands/brand-1/workshop.webp'],
      imageAlts: [
        {
          isLogo: false,
          isOwnerSupplied: false,
        },
        { isLogo: false, isOwnerSupplied: false },
      ],
    })
  })

  /*
   * 品牌提供 is DERIVED here and nowhere else.
   *
   * `source` is the only rights signal on a brand image, and `'owner'` is the
   * only value that means the brand handed us the file — `syncOwnerUploadedImages()`
   * writes it when an owner uploads through the dashboard wizard. Every other
   * value ('scrape', 'google_image', 'admin', 'legacy', 'json_ld') is Formoria
   * or a crawler, so they all collapse to the same false rather than being
   * enumerated: a new source value added upstream must fail closed, uncredited,
   * until someone decides it is owner-supplied.
   *
   * It rides `imageAlts` because that array is already index-aligned with the
   * unfiltered `[heroImageUrl, ...productPhotos]` sequence the gallery renders.
   * A parallel array would be a second thing to keep aligned, and the
   * misalignment would credit the brand for someone else's photograph.
   */
  it('marks only owner-uploaded images as brand-supplied', () => {
    const sourced = [
      { storage_path: 'brands/brand-1/owner.webp', status: 'active', sort_order: 0, source: 'owner' },
      { storage_path: 'brands/brand-1/scraped.webp', status: 'active', sort_order: 1, source: 'scrape' },
      { storage_path: 'brands/brand-1/found.webp', status: 'active', sort_order: 2, source: 'google_image' },
      { storage_path: 'brands/brand-1/admin.webp', status: 'active', sort_order: 3, source: 'admin' },
      { storage_path: 'brands/brand-1/legacy.webp', status: 'active', sort_order: 4, source: 'legacy' },
      { storage_path: 'brands/brand-1/unknown.webp', status: 'active', sort_order: 5 },
    ]

    expect(
      toImageFields(sourced as never).imageAlts.map((meta) => meta.isOwnerSupplied),
    ).toEqual([true, false, false, false, false, false])
  })

  it('flags logo-tagged images so the renderer can contain rather than crop them', () => {
    const tagged = [
      {
        storage_path: 'brands/brand-1/mark.webp',
        status: 'active',
        sort_order: 0,
        tags: ['logo'],
      },
      {
        storage_path: 'brands/brand-1/tote.webp',
        status: 'active',
        sort_order: 1,
        tags: ['product'],
      },
      { storage_path: 'brands/brand-1/untagged.webp', status: 'active', sort_order: 2 },
    ]

    expect(toImageFields(tagged as never).imageAlts.map((meta) => meta.isLogo)).toEqual([
      true,
      false,
      false,
    ])
  })
})

describe('getBrandImages', () => {
  /*
   * The projection is asserted, not assumed.
   *
   * The service client carries no `Database` generic, so a column missing from
   * this string is not a type error and not a query error — every row simply
   * comes back with `source: undefined`, `isOwnerSupplied` is false everywhere,
   * and the 品牌提供 credit silently never renders. That failure looks exactly
   * like "no brand has uploaded an image yet", which is also the expected state
   * today, so nothing else in the system could tell them apart.
   */
  it('projects the columns the gallery renders from, including the rights signal', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const statusEq = vi.fn(() => ({ order }))
    const brandEq = vi.fn(() => ({ eq: statusEq }))
    // Typed parameter, not a bare `vi.fn()`: the projection string is what this
    // test reads back, and an untyped mock records it as `never`.
    const select = vi.fn((_columns: string) => ({ eq: brandEq }))
    const client = { from: vi.fn(() => ({ select })) }

    await getBrandImages(client, 'brand-id')

    const columns = (select.mock.calls[0]?.[0] ?? '').split(',').map((c) => c.trim())
    expect(columns).toContain('source')
  })
})

describe('getBrandGalleryImages', () => {
  it('keeps the hero followed by every valid product image', () => {
    expect(
      getBrandGalleryImages({
        heroImageUrl: 'https://images.example.com/hero.webp',
        productPhotos: [
          'https://images.example.com/product-one.webp',
          '',
          'https://images.example.com/product-two.webp',
        ],
      }),
    ).toEqual([
      'https://images.example.com/hero.webp',
      'https://images.example.com/product-one.webp',
      'https://images.example.com/product-two.webp',
    ])
  })
})

describe('getBrandGalleryImageEntries', () => {
  /*
   * The index a dropped entry shifts is not decorative any more. `imageAlts` is
   * built as `active.map(...)` over the UNFILTERED
   * `[heroImageUrl, ...productPhotos]` sequence, and that metadata now selects
   * fill mode (`isLogo`) as well as alt text — so a one-place shift letterboxes
   * a product photo and crops a logo, rather than merely mislabelling one.
   */
  it('reports the unfiltered position of each surviving url', () => {
    expect(
      getBrandGalleryImageEntries({
        heroImageUrl: 'https://images.example.com/hero.webp',
        productPhotos: [
          'https://images.example.com/product-one.webp',
          '',
          'https://images.example.com/product-two.webp',
        ],
      }),
    ).toEqual([
      { url: 'https://images.example.com/hero.webp', sourceIndex: 0 },
      { url: 'https://images.example.com/product-one.webp', sourceIndex: 1 },
      { url: 'https://images.example.com/product-two.webp', sourceIndex: 3 },
    ])
  })

  it('keeps product photos on their original indices when the hero is null', () => {
    // The case that shifted everything: a null hero is dropped, so the first
    // product photo lands at array position 0 while its metadata still lives at
    // index 1.
    expect(
      getBrandGalleryImageEntries({
        heroImageUrl: null,
        productPhotos: [
          'https://images.example.com/product-one.webp',
          'https://images.example.com/product-two.webp',
        ],
      }),
    ).toEqual([
      { url: 'https://images.example.com/product-one.webp', sourceIndex: 1 },
      { url: 'https://images.example.com/product-two.webp', sourceIndex: 2 },
    ])
  })
})

describe('rejectBrandImages', () => {
  beforeEach(() => {
    storageRemoveMock.mockReset()
    storageRemoveMock.mockResolvedValue(undefined)
  })


  it('still marks rows rejected when storage deletion fails', async () => {
    const storageError = new Error('storage deletion failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { client, update } = createRejectClient([{ storage_path: HERO_KEY }])
    storageRemoveMock.mockRejectedValueOnce(storageError)

    await expect(
      rejectBrandImages(client, 'brand-1', [HERO_REF]),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      '[rejectBrandImages] Failed to delete rejected images for brand-1:',
      storageError,
    )
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })

    consoleError.mockRestore()
  })
})

describe('releaseBrandImageUrls', () => {
  beforeEach(() => {
    storageRemoveMock.mockReset()
    storageRemoveMock.mockResolvedValue(undefined)
  })

  it('rejects the row instead of deleting storage behind its back', async () => {
    const { client, update } = createRejectClient([{ storage_path: HERO_KEY }])

    await releaseBrandImageUrls(client, 'brand-1', [HERO_REF])

    // Row and storage object are updated as a pair — never a raw storage delete
    // that would leave an active row pointing at a missing object.
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(storageRemoveMock).toHaveBeenCalledWith([HERO_KEY])
  })

  it('deletes storage for keys no row references', async () => {
    const { client, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [ORPHAN_REF])

    expect(storageRemoveMock).toHaveBeenCalledWith([ORPHAN_KEY])
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects matched keys and raw-deletes unmatched ones in a single batch', async () => {
    const { client, update, updateIn } = createRejectClient([
      { storage_path: HERO_KEY },
    ])

    await releaseBrandImageUrls(client, 'brand-1', [HERO_REF, ORPHAN_REF])

    // Matched key: row + storage object go together via rejectBrandImages.
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(updateIn).toHaveBeenCalledWith('storage_path', [HERO_KEY])
    // Unmatched key: no row references it, so a raw storage delete is safe.
    expect(storageRemoveMock).toHaveBeenCalledWith([ORPHAN_KEY])
  })

  it('treats an already-rejected row as referenced and never raw-deletes its key', async () => {
    // Tripwire: the lookup in releaseBrandImageUrls deliberately has NO status
    // filter. Adding .eq('status', 'active') would hide this row, the key would
    // look unreferenced, and the raw storage delete would nuke an object a live
    // row still points at. This client filters by status when asked, so that
    // regression turns this test red.
    const { client, update } = createStatusFilteringClient([
      { storage_path: HERO_KEY, status: 'rejected' },
    ])

    await releaseBrandImageUrls(client, 'brand-1', [HERO_REF])

    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    // Rejected through rejectBrandImages, which pairs the row update with the
    // object delete — never a bare delete of an unreferenced key.
    expect(storageRemoveMock).toHaveBeenCalledWith([HERO_KEY])
  })

  it('does nothing when there are no references', async () => {
    const { client, select, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [])

    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(storageRemoveMock).not.toHaveBeenCalled()
  })

  it('never raw-deletes outside `brands/`, even for an unreferenced key', async () => {
    // `deleteStoredImagePaths` also accepts `submissions/` and
    // `curated-products/`. Owner cleanup must not reach either: a curated key
    // that no `brand_images` row references is still live through
    // `curated_products.image_url`, and deleting it breaks a reference the
    // storage sweep cannot flag.
    const CURATED_KEY = 'curated-products/brand-1/p/abc.webp'
    const SUBMISSION_KEY = 'submissions/sub-1/photo.webp'
    const { client, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [
      `/i/${CURATED_KEY}`,
      `/i/${SUBMISSION_KEY}`,
      ORPHAN_REF,
    ])

    expect(update).not.toHaveBeenCalled()
    expect(storageRemoveMock).toHaveBeenCalledTimes(1)
    expect(storageRemoveMock).toHaveBeenCalledWith([ORPHAN_KEY])
  })

  it('skips the storage call entirely when nothing deletable is left', async () => {
    const { client } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [
      '/i/curated-products/brand-1/p/abc.webp',
    ])

    expect(storageRemoveMock).not.toHaveBeenCalled()
  })

  it('ignores a reference that is not one of our objects', async () => {
    // An owner-pasted third-party URL resolves to no bucket key. Skipping it is
    // the safe direction: these functions delete storage objects.
    const { client, select, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [
      'https://cdn.example.com/not-ours.jpg',
    ])

    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(storageRemoveMock).not.toHaveBeenCalled()
  })
})
