import { describe, expect, it } from 'vitest'
import { getBrandVisitHref } from './link-fallback'

const emptyLinks = {
  purchaseWebsite: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchasePinkoi: null,
  purchaseShopee: null,
}

describe('getBrandVisitHref', () => {
  it('uses the brand visit fallback order', () => {
    expect(
      getBrandVisitHref({
        ...emptyLinks,
        socialInstagram: '@warmwood',
        socialThreads: '@threads-warmwood',
        socialFacebook: 'https://facebook.com/warmwood',
        purchasePinkoi: 'https://pinkoi.com/store/warmwood',
        purchaseShopee: 'https://shopee.tw/warmwood',
      }),
    ).toBe('https://pinkoi.com/store/warmwood')

    expect(
      getBrandVisitHref({
        ...emptyLinks,
        socialThreads: '@threads-warmwood',
        socialFacebook: 'https://facebook.com/warmwood',
        purchasePinkoi: 'https://pinkoi.com/store/warmwood',
      }),
    ).toBe('https://pinkoi.com/store/warmwood')

    expect(
      getBrandVisitHref({
        ...emptyLinks,
        purchaseWebsite: 'warmwood.example',
        socialInstagram: '@warmwood',
      }),
    ).toBe('https://warmwood.example')
  })
})
