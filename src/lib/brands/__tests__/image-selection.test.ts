import { describe, expect, it } from 'vitest'

import { selectBrandCardImage } from '../image-selection'

const logoUrl = 'https://atelier.supabase.co/storage/v1/object/public/logo.png'
const productUrl =
  'https://atelier.supabase.co/storage/v1/object/public/ceramic-cup.jpg'

describe('selectBrandCardImage', () => {
  it('chooses the first non-logo product photo with its aligned metadata', () => {
    const logoMeta = {
      altZh: '品牌標誌',
      altEn: 'Brand logo',
      isLogo: true,
      focalX: null,
      focalY: null,
    }
    const productMeta = {
      altZh: '陶瓷杯',
      altEn: 'Ceramic cup',
      isLogo: false,
      focalX: 0.25,
      focalY: 0.75,
    }

    expect(
      selectBrandCardImage({
        heroImageUrl: logoUrl,
        productPhotos: [productUrl],
        imageAlts: [logoMeta, productMeta],
      }),
    ).toEqual({ src: productUrl, meta: productMeta })
  })
})
