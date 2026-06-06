import { describe, it, expect } from 'vitest'
import { collectSyncableImageUrls } from '../brands'

describe('collectSyncableImageUrls', () => {
  it('excludes tracking/non-image hosts from sync candidates', () => {
    const urls = collectSyncableImageUrls({
      heroImageUrl: 'https://www.facebook.com/tr?id=1&ev=PageView',
      logoUrl: null,
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
      logoUrl: null,
      productPhotos: [],
    })
    expect(urls).toEqual([])
  })
})
