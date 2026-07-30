import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getBrandGalleryImages,
  insertBrandImage,
  rejectBrandImages,
  releaseBrandImageUrls,
  syncHeroDenormalized,
  toImageFields,
} from './brand-images'

const { storageRemoveMock, deleteBrandImagesMock } = vi.hoisted(() => ({
  storageRemoveMock: vi.fn(),
  deleteBrandImagesMock: vi.fn(),
}))

vi.mock('./image-upload', () => ({
  deleteStoredImagePaths: storageRemoveMock,
  deleteBrandImages: deleteBrandImagesMock,
}))

function createSyncClient(images: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: images, error: null })
  const statusEq = vi.fn(() => ({ order }))
  const brandIdEq = vi.fn(() => ({ eq: statusEq }))
  const select = vi.fn(() => ({ eq: brandIdEq }))
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => (
    table === 'brand_images' ? { select } : { update }
  ))

  return { client: { from }, update, updateEq }
}

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

type StatusRow = { url: string; storage_path: string | null; status: string }

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
    url: 'https://cdn.supabase.co/a.jpg',
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
      url: 'https://cdn.supabase.co/a.jpg',
      source: 'owner',
    })

    expect(select).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
  })
})

describe('toImageFields', () => {
  const rows = [
    { url: 'https://images.formoria.com/rejected-campaign.webp', status: 'rejected', sort_order: 0 },
    {
      url: 'https://images.formoria.com/藺草編織包.webp',
      status: 'active',
      sort_order: 0,
      alt_zh: '職人手工編織的藺草提包',
      alt_en: 'Handwoven rush-grass tote bag',
      width: 1600,
      height: 1200,
    },
    { url: 'https://images.formoria.com/workshop.webp', status: 'active', sort_order: 1 },
  ]

  it('keeps stored hero metadata aligned with the selected active image', () => {
    expect(toImageFields(rows as never)).toEqual({
      heroImageUrl: 'https://images.formoria.com/藺草編織包.webp',
      heroImageMetadata: {
        altZh: '職人手工編織的藺草提包',
        altEn: 'Handwoven rush-grass tote bag',
        width: 1600,
        height: 1200,
      },
      productPhotos: ['https://images.formoria.com/workshop.webp'],
      imageAlts: [
        { altZh: '職人手工編織的藺草提包', altEn: 'Handwoven rush-grass tote bag' },
        { altZh: null, altEn: null },
      ],
    })
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

describe('rejectBrandImages', () => {
  beforeEach(() => {
    storageRemoveMock.mockReset()
    storageRemoveMock.mockResolvedValue(undefined)
  })


  it('still marks rows rejected when storage deletion fails', async () => {
    const storageError = new Error('storage deletion failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { client, update } = createRejectClient([
      { storage_path: 'brands/brand-1/a.jpg' },
    ])
    storageRemoveMock.mockRejectedValueOnce(storageError)

    await expect(rejectBrandImages(client, 'brand-1', ['https://example.com/a.jpg']))
      .resolves.toBeUndefined()

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
    deleteBrandImagesMock.mockReset()
    deleteBrandImagesMock.mockResolvedValue(undefined)
  })

  it('rejects the row instead of deleting storage behind its back', async () => {
    const { client, update } = createRejectClient([
      { url: 'https://example.com/a.jpg', storage_path: 'brands/brand-1/a.jpg' },
    ])

    await releaseBrandImageUrls(client, 'brand-1', ['https://example.com/a.jpg'])

    // Row and storage object are updated as a pair — never a raw storage delete
    // that would leave an active row pointing at a missing object.
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(storageRemoveMock).toHaveBeenCalledWith(['brands/brand-1/a.jpg'])
    expect(deleteBrandImagesMock).not.toHaveBeenCalled()
  })

  it('leaves storage alone when the referencing row has no storage_path', async () => {
    const { client, update } = createRejectClient([
      { url: 'https://example.com/a.jpg', storage_path: null },
    ])

    await releaseBrandImageUrls(client, 'brand-1', ['https://example.com/a.jpg'])

    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(storageRemoveMock).not.toHaveBeenCalled()
    expect(deleteBrandImagesMock).not.toHaveBeenCalled()
  })

  it('deletes storage for urls no row references', async () => {
    const { client, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', ['https://example.com/tmp.jpg'])

    expect(deleteBrandImagesMock).toHaveBeenCalledWith([
      'https://example.com/tmp.jpg',
    ])
    expect(update).not.toHaveBeenCalled()
    expect(storageRemoveMock).not.toHaveBeenCalled()
  })

  it('rejects matched urls and raw-deletes unmatched ones in a single batch', async () => {
    const { client, update, updateIn } = createRejectClient([
      { url: 'https://example.com/a.jpg', storage_path: 'brands/brand-1/a.jpg' },
    ])

    await releaseBrandImageUrls(client, 'brand-1', [
      'https://example.com/a.jpg',
      'https://example.com/orphan.jpg',
    ])

    // Matched url: row + storage object go together via rejectBrandImages.
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(updateIn).toHaveBeenCalledWith('url', ['https://example.com/a.jpg'])
    expect(storageRemoveMock).toHaveBeenCalledWith(['brands/brand-1/a.jpg'])
    // Unmatched url: no row references it, so a raw storage delete is safe.
    expect(deleteBrandImagesMock).toHaveBeenCalledWith([
      'https://example.com/orphan.jpg',
    ])
  })

  it('treats an already-rejected row as referenced and never raw-deletes its url', async () => {
    // Tripwire: the lookup in releaseBrandImageUrls deliberately has NO status
    // filter. Adding .eq('status', 'active') would hide this row, the url would
    // look unreferenced, and deleteBrandImages would nuke a storage object that
    // a live row still points at. This client filters by status when asked, so
    // that regression turns this test red.
    const { client, update } = createStatusFilteringClient([
      {
        url: 'https://example.com/a.jpg',
        storage_path: 'brands/brand-1/a.jpg',
        status: 'rejected',
      },
    ])

    await releaseBrandImageUrls(client, 'brand-1', ['https://example.com/a.jpg'])

    expect(deleteBrandImagesMock).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
  })

  it('does nothing when there are no urls', async () => {
    const { client, select, update } = createRejectClient([])

    await releaseBrandImageUrls(client, 'brand-1', [])

    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(storageRemoveMock).not.toHaveBeenCalled()
    expect(deleteBrandImagesMock).not.toHaveBeenCalled()
  })
})
