import { describe, it, expect } from 'vitest'
import { buildSyncedImagePatch, collectSyncableImageUrls } from '../brands'

describe('collectSyncableImageUrls', () => {
  it('excludes tracking/non-image hosts from sync candidates', () => {
    const urls = collectSyncableImageUrls({
      heroImageUrl: 'https://www.facebook.com/tr?id=1&ev=PageView',
      productPhotos: [
        'https://cdn01.pinkoi.com/product/x/1/800x0.jpg',
        'https://tr.line.me/tag.gif?e=pv',
      ],
    })
    expect(urls).toEqual(['https://cdn01.pinkoi.com/product/x/1/800x0.jpg'])
  })

  it('skips URLs already hosted on Supabase', () => {
    const urls = collectSyncableImageUrls({
      heroImageUrl: 'https://project.supabase.co/storage/v1/object/public/brand/x.webp',
      productPhotos: [],
    })
    expect(urls).toEqual([])
  })
})

describe('buildSyncedImagePatch', () => {
  it('maps successful downloads to hero and product photo positions', () => {
    const patch = buildSyncedImagePatch(
      [
        { url: 'https://example.com/hero.jpg', field: 'hero' },
        { url: 'https://example.com/photo-0.jpg', field: 'photo', index: 0 },
        { url: 'https://example.com/photo-1.jpg', field: 'photo', index: 1 },
      ],
      ['https://cdn.supabase.co/hero.jpg', 'https://cdn.supabase.co/photo-0.jpg', 'https://cdn.supabase.co/photo-1.jpg'],
      ['originalPhoto0', 'originalPhoto1'],
    )

    expect(patch.heroImageUrl).toBe('https://cdn.supabase.co/hero.jpg')
    expect(patch.productPhotos).toEqual([
      'https://cdn.supabase.co/photo-0.jpg',
      'https://cdn.supabase.co/photo-1.jpg',
    ])
  })

  it('preserves original photo positions when a middle download fails', () => {
    const patch = buildSyncedImagePatch(
      [
        { url: 'https://example.com/hero.jpg', field: 'hero' },
        { url: 'https://example.com/photo-0.jpg', field: 'photo', index: 0 },
        { url: 'https://example.com/photo-1.jpg', field: 'photo', index: 1 },
      ],
      ['https://cdn.supabase.co/hero.jpg', null, 'https://cdn.supabase.co/photo-1.jpg'],
      ['originalPhoto0', 'originalPhoto1'],
    )

    expect(patch.heroImageUrl).toBe('https://cdn.supabase.co/hero.jpg')
    expect(patch.productPhotos).toEqual([
      'originalPhoto0',
      'https://cdn.supabase.co/photo-1.jpg',
    ])
  })

  it('skips failed hero while syncing successful photo downloads', () => {
    const patch = buildSyncedImagePatch(
      [
        { url: 'https://example.com/hero.jpg', field: 'hero' },
        { url: 'https://example.com/photo-0.jpg', field: 'photo', index: 0 },
      ],
      [null, 'https://cdn.supabase.co/photo-0.jpg'],
      ['originalPhoto0'],
    )

    expect(patch.heroImageUrl).toBeUndefined()
    expect(patch.productPhotos).toEqual(['https://cdn.supabase.co/photo-0.jpg'])
  })
})
