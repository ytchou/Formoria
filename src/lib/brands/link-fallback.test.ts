import { describe, expect, it } from 'vitest'
import { getBrandVisitLink } from './link-fallback'

const emptyLinks = {
  purchaseWebsite: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchasePinkoi: null,
  purchaseShopee: null,
}

describe('getBrandVisitLink', () => {
  it('uses the brand visit fallback order', () => {
    expect(
      getBrandVisitLink({
        ...emptyLinks,
        socialInstagram: '@warmwood',
        socialThreads: '@threads-warmwood',
        socialFacebook: 'https://facebook.com/warmwood',
        purchasePinkoi: 'https://pinkoi.com/store/warmwood',
        purchaseShopee: 'https://shopee.tw/warmwood',
      }),
    ).toEqual({ href: 'https://pinkoi.com/store/warmwood', kind: 'pinkoi' })

    expect(
      getBrandVisitLink({
        ...emptyLinks,
        socialThreads: '@threads-warmwood',
        socialFacebook: 'https://facebook.com/warmwood',
        purchasePinkoi: 'https://pinkoi.com/store/warmwood',
      }),
    ).toEqual({ href: 'https://pinkoi.com/store/warmwood', kind: 'pinkoi' })

    expect(
      getBrandVisitLink({
        ...emptyLinks,
        purchaseWebsite: 'warmwood.example',
        socialInstagram: '@warmwood',
      }),
    ).toEqual({ href: 'https://warmwood.example', kind: 'website' })
  })

  it('classifies by hostname when a marketplace url is stored as the website', () => {
    expect(
      getBrandVisitLink({
        ...emptyLinks,
        purchaseWebsite: 'https://pinkoi.com/store/cucare',
      }),
    ).toEqual({ href: 'https://pinkoi.com/store/cucare', kind: 'pinkoi' })

    expect(
      getBrandVisitLink({
        ...emptyLinks,
        purchaseWebsite: 'https://hk.pinkoi.com/store/cucare',
      }),
    ).toEqual({ href: 'https://hk.pinkoi.com/store/cucare', kind: 'pinkoi' })
  })

  it('labels the instagram handle fallback as instagram', () => {
    expect(
      getBrandVisitLink({ ...emptyLinks, socialInstagram: '@warmwood' }),
    ).toEqual({ href: 'https://instagram.com/warmwood', kind: 'instagram' })
  })

  it('returns null when every link is empty', () => {
    expect(getBrandVisitLink(emptyLinks)).toBeNull()
  })
})
