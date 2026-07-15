import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rejectBrandImages, syncHeroDenormalized, toImageFields } from './brand-images'

const { storageRemoveMock } = vi.hoisted(() => ({
  storageRemoveMock: vi.fn(),
}))

vi.mock('./image-upload', () => ({
  deleteStoredImagePaths: storageRemoveMock,
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

  return { client: { from }, deleteRow, update, updateIn }
}

describe('toImageFields', () => {
  const rows = [
    { url: 'promo.jpg', status: 'rejected', sort_order: 0 },
    { url: 'prod.jpg', status: 'active', sort_order: 0 },
    { url: 'life.jpg', status: 'active', sort_order: 1 },
  ]

  it('maps active rows to the existing domain shape (hero + productPhotos + imageAlts)', () => {
    expect(toImageFields(rows as never)).toEqual({
      heroImageUrl: 'prod.jpg',
      productPhotos: ['life.jpg'],
      imageAlts: [
        { altZh: null, altEn: null },
        { altZh: null, altEn: null },
      ],
    })
  })
})

describe('rejectBrandImages', () => {
  beforeEach(() => {
    storageRemoveMock.mockReset()
    storageRemoveMock.mockResolvedValue(undefined)
  })

  it('deletes storage objects and nulls storage_path when rejecting', async () => {
    const urlA = 'https://example.com/a.jpg'
    const urlB = 'https://example.com/b.png'
    const urlAlreadyPurged = 'https://example.com/purged.webp'
    const { client, deleteRow, update, updateIn } = createRejectClient([
      { storage_path: 'brands/brand-1/a.jpg' },
      { storage_path: 'brands/brand-1/b.png' },
      { storage_path: null },
    ])

    await rejectBrandImages(client, 'brand-1', [urlA, urlB, urlAlreadyPurged])

    expect(storageRemoveMock).toHaveBeenCalledWith([
      'brands/brand-1/a.jpg',
      'brands/brand-1/b.png',
    ])
    expect(update).toHaveBeenCalledWith({ status: 'rejected', storage_path: null })
    expect(updateIn).toHaveBeenCalledWith('url', [urlA, urlB, urlAlreadyPurged])
    expect(deleteRow).not.toHaveBeenCalled()
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

describe('syncHeroDenormalized', () => {
  it('uses the same first active image shown on the brand detail page', async () => {
    const { client, update, updateEq } = createSyncClient([
      { url: 'first.jpg', status: 'active', sort_order: 0, tags: ['product'], score: 70 },
      { url: 'second.jpg', status: 'active', sort_order: 1, tags: ['product'], score: 95 },
    ])

    await syncHeroDenormalized(client, 'brand-1')

    expect(update).toHaveBeenCalledWith({ hero_image_url: 'first.jpg' })
    expect(updateEq).toHaveBeenCalledWith('id', 'brand-1')
  })

  it('clears the denormalized hero when no active images remain', async () => {
    const { client, update } = createSyncClient([])

    await syncHeroDenormalized(client, 'brand-1')

    expect(update).toHaveBeenCalledWith({ hero_image_url: null })
  })
})
