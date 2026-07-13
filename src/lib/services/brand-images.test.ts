import { describe, it, expect, vi } from 'vitest'

import { toImageFields, syncHeroDenormalized } from './brand-images'

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
