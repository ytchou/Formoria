import { describe, it, expect } from 'vitest'
import { collectSyncableImageUrls } from '../brands'

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

  it('skips images we already own (the /i/ proxy form)', () => {
    const urls = collectSyncableImageUrls({
      heroImageUrl: '/i/brands/x/x.webp',
      productPhotos: [],
    })
    expect(urls).toEqual([])
  })
})
