import { describe, expect, it } from 'vitest'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  canonicalizeThreadsUrl,
  classifySubmittedUrl,
  extractLinksFromUrls,
  hasLinkValue,
  isBareRootUrl,
  isMarketplaceSearchUrl,
  isPinkoiStorefrontUrl,
  LINK_FIELDS,
  linkColumnFor,
  type LinkField,
} from '../link-enrichment'

const EMPTY_BRAND = {
  social_instagram: null,
  social_threads: null,
  social_facebook: null,
  purchase_website: null,
  purchase_pinkoi: null,
  purchase_shopee: null,
  purchase_myship: null,
}

// A search page renders as a buy link but sends the reader to other sellers'
// listings. `shopee.tw/search?keyword=女子鞋研究室` reached a live row this way.
describe('isMarketplaceSearchUrl', () => {
  it('rejects a keyword search page', () => {
    expect(
      isMarketplaceSearchUrl('https://shopee.tw/search?keyword=%E5%A5%B3%E5%AD%90%E9%9E%8B%E7%A0%94%E7%A9%B6%E5%AE%A4')
    ).toBe(true)
  })

  it('rejects a bare host carrying only a search term', () => {
    expect(isMarketplaceSearchUrl('https://www.pinkoi.com/?q=brand')).toBe(true)
  })

  it('accepts real storefronts', () => {
    expect(isMarketplaceSearchUrl('https://shopee.tw/jennytseng1')).toBe(false)
    expect(isMarketplaceSearchUrl('https://www.pinkoi.com/store/majorpleasure')).toBe(false)
  })

  // A tracking query string must not smuggle a search page past the gate, and
  // a malformed value is rejected rather than published.
  it('matches on pathname, and rejects a malformed URL', () => {
    expect(isMarketplaceSearchUrl('https://shopee.tw/search/?utm_source=ig')).toBe(true)
    expect(isMarketplaceSearchUrl('not a url')).toBe(true)
  })
})

describe('canonicalizeThreadsUrl', () => {
  it('rewrites threads.net to threads.com, preserving path and query', () => {
    expect(canonicalizeThreadsUrl('https://threads.net/@brand')).toBe('https://threads.com/@brand')
    expect(canonicalizeThreadsUrl('https://www.threads.net/@brand/post?x=1')).toBe(
      'https://www.threads.com/@brand/post?x=1'
    )
  })

  it('leaves a threads.com URL unchanged', () => {
    expect(canonicalizeThreadsUrl('https://www.threads.com/@brand')).toBe(
      'https://www.threads.com/@brand'
    )
  })

  it('returns non-Threads and malformed values unchanged, never throwing', () => {
    expect(canonicalizeThreadsUrl('https://brand.com/threads.net')).toBe(
      'https://brand.com/threads.net'
    )
    expect(canonicalizeThreadsUrl('threads.net/@brand')).toBe('threads.net/@brand')
    expect(canonicalizeThreadsUrl('@brand')).toBe('@brand')
    expect(canonicalizeThreadsUrl('')).toBe('')
  })
})

describe('hasLinkValue', () => {
  it('returns false for null', () => { expect(hasLinkValue(null)).toBe(false) })
  it('returns false for empty string', () => { expect(hasLinkValue('')).toBe(false) })
  it('returns true for a URL string', () => { expect(hasLinkValue('https://instagram.com/brand')).toBe(true) })
})

describe('linkColumnFor', () => {
  it.each([
    ['socialInstagram', 'social_instagram'],
    ['socialThreads', 'social_threads'],
    ['socialFacebook', 'social_facebook'],
    ['purchaseWebsite', 'purchase_website'],
    ['purchasePinkoi', 'purchase_pinkoi'],
    ['purchaseShopee', 'purchase_shopee'],
    ['purchaseMyship', 'purchase_myship'],
  ] as const)('maps %s to %s', (field, column) => {
    expect(linkColumnFor(field)).toBe(column)
  })
})

describe('LINK_FIELDS', () => {
  it('LINK_FIELDS contains exactly 7 fields', () => { expect(LINK_FIELDS).toHaveLength(7) })
})

describe('buildLinkEnrichPatch', () => {
  it('declines to write a marketplace search page over an empty column', () => {
    const patch = buildLinkEnrichPatch(
      {
        social_instagram: null, social_threads: null, social_facebook: null,
        purchase_website: null, purchase_pinkoi: null, purchase_shopee: null,
      },
      { purchaseShopee: 'https://shopee.tw/search?keyword=brand' }
    )
    expect(patch.purchase_shopee).toBeUndefined()
  })

  // Regression guard: scraped values are NOT gated on the registry's
  // `urlPattern` (the strict classifier for *submitted* URLs). Gating on it
  // dropped these legitimate storefronts, and — when the column already held a
  // value — wrote null over it.
  it.each([
    'https://shopee.com.tw/mybrand',
    'https://shopee.tw/mybrand?af_id=1',
    'https://shopee.tw/mybrand/',
    'https://shopee.tw/shop/12345/products',
  ])('preserves the scraped Shopee storefront %s', (url) => {
    expect(
      buildLinkEnrichPatch(
        {
          social_instagram: null, social_threads: null, social_facebook: null,
          purchase_website: null, purchase_pinkoi: null, purchase_shopee: null,
        },
        { purchaseShopee: url }
      ).purchase_shopee
    ).toBe(url)
  })

  it('never erases an existing Shopee column with a valid scraped variant', () => {
    const patch = buildLinkEnrichPatch(
      {
        social_instagram: null, social_threads: null, social_facebook: null,
        purchase_website: null, purchase_pinkoi: null,
        purchase_shopee: 'https://shopee.tw/mybrand',
      },
      { purchaseShopee: 'https://shopee.com.tw/mybrand' }
    )
    expect(patch.purchase_shopee).not.toBeNull()
  })

  it('fills empty link fields from scraped data', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: 'https://facebook.com/existing',
      purchase_website: null, purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/brand', socialThreads: null,
      socialFacebook: 'https://facebook.com/scraped',
      purchaseWebsite: 'https://brand.com', purchasePinkoi: null,
      purchaseShopee: 'https://shopee.tw/brand',
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/brand')
    expect(patch.social_facebook).toBe('https://facebook.com/scraped')
    expect(patch.purchase_website).toBe('https://brand.com')
    expect(patch.purchase_shopee).toBe('https://shopee.tw/brand')
    expect(patch.social_threads).toBeUndefined()
    expect(patch.purchase_pinkoi).toBeUndefined()
  })

  it('returns empty patch when all fields match scraped data', () => {
    const brand = {
      // threads.com, not .net: the scraped value is canonicalised before the
      // comparison, so a stored .net would (correctly) produce a patch.
      social_instagram: 'https://instagram.com/x', social_threads: 'https://threads.com/x',
      social_facebook: 'https://facebook.com/x', purchase_website: 'https://x.com',
      purchase_pinkoi: 'https://pinkoi.com/x', purchase_shopee: 'https://shopee.tw/x',
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/x', socialThreads: 'https://threads.com/x',
      socialFacebook: 'https://facebook.com/x', purchaseWebsite: 'https://x.com',
      purchasePinkoi: 'https://pinkoi.com/x', purchaseShopee: 'https://shopee.tw/x',
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('canonicalises a scraped threads.net URL onto threads.com', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: null, socialThreads: 'https://www.threads.net/@brand',
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_threads).toBe('https://www.threads.com/@brand')
  })

  // Once a platform host lands in purchase_website the image phase issues
  // `site:{host} {name}` and searches the whole platform, not the brand.
  it.each([
    'https://www.threads.com/@brand',
    'https://linktr.ee/brand',
    'https://shopee.tw/brand',
  ])('refuses to write the platform URL %s into purchase_website', (purchaseWebsite) => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, {
      socialInstagram: null, socialThreads: null, socialFacebook: null,
      purchaseWebsite, purchasePinkoi: null, purchaseShopee: null,
    })
    expect(patch.purchase_website).toBeUndefined()
  })

  it('declines rather than clobbers: an existing website survives a platform scrape', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: null, purchase_website: 'https://brand.com',
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, {
      socialInstagram: null, socialThreads: null, socialFacebook: null,
      purchaseWebsite: 'https://www.threads.com/@brand',
      purchasePinkoi: null, purchaseShopee: null,
    })
    expect(patch.purchase_website).toBeUndefined()
  })

  it('updates existing fields when scraped data differs', () => {
    const brand = {
      social_instagram: 'https://instagram.com/old', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/new', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/new')
  })

  it('replaces corporate account with scraped value', () => {
    const brand = {
      social_instagram: 'https://instagram.com/ilovepinkoi', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/realbrand', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/realbrand')
  })

  it('nullifies corporate account when no replacement available', () => {
    const brand = {
      social_instagram: 'https://instagram.com/ilovepinkoi', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: null, socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBeNull()
  })

  it('skips scraped values that are corporate accounts', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/ilovepinkoi', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBeUndefined()
  })
})

describe('extractLinksFromUrls', () => {
  it('maps Instagram URL to social_instagram', () => {
    const result = extractLinksFromUrls(['https://www.instagram.com/mybrand/'])
    expect(result.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('maps Threads URL to social_threads', () => {
    const result = extractLinksFromUrls(['https://www.threads.net/@mybrand'])
    expect(result.social_threads).toBe('https://www.threads.net/@mybrand')
  })

  it('maps Facebook URL to social_facebook', () => {
    const result = extractLinksFromUrls(['https://www.facebook.com/mybrand'])
    expect(result.social_facebook).toBe('https://www.facebook.com/mybrand')
  })

  it('maps Pinkoi URL to purchase_pinkoi', () => {
    const result = extractLinksFromUrls(['https://www.pinkoi.com/store/mybrand'])
    expect(result.purchase_pinkoi).toBe('https://www.pinkoi.com/store/mybrand')
  })

  it('maps Shopee URL to purchase_shopee', () => {
    const result = extractLinksFromUrls(['https://shopee.tw/mybrand'])
    expect(result.purchase_shopee).toBe('https://shopee.tw/mybrand')
  })

  it('maps a MyShip detail URL to purchase_myship', () => {
    const result = extractLinksFromUrls([
      'https://myship.7-11.com.tw/general/detail/GM123456',
    ])
    expect(result.purchase_myship).toBe(
      'https://myship.7-11.com.tw/general/detail/GM123456',
    )
  })

  it.each([
    'https://myship.7-11.com.tw/store/GM123456',
    'https://myship.7-11.com.tw/e-tracking/detail/GM123456',
  ])('ignores a non-detail MyShip URL %s', (url) => {
    expect(extractLinksFromUrls([url])).toEqual({})
  })

  it('ignores unrecognized URLs', () => {
    const result = extractLinksFromUrls(['https://example.com/page'])
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('handles multiple URLs from different platforms', () => {
    const result = extractLinksFromUrls([
      'https://www.instagram.com/mybrand/',
      'https://www.pinkoi.com/store/mybrand',
      'https://example.com',
    ])
    expect(result.social_instagram).toBe('https://www.instagram.com/mybrand/')
    expect(result.purchase_pinkoi).toBe('https://www.pinkoi.com/store/mybrand')
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('rejects corporate account URLs', () => {
    const result = extractLinksFromUrls([
      'https://www.instagram.com/ilovepinkoi/',
      'https://www.facebook.com/shopee.tw',
    ])
    expect(Object.keys(result)).toHaveLength(0)
  })
})

// `https://www.pinkoi.com/` reached a live `purchase_pinkoi` column twice in one
// refresh run: once over an empty column, once over a real storefront.
describe('isBareRootUrl / isPinkoiStorefrontUrl', () => {
  it('treats a platform front door as bare, with or without the trailing slash', () => {
    expect(isBareRootUrl('https://www.instagram.com/')).toBe(true)
    expect(isBareRootUrl('https://www.instagram.com')).toBe(true)
    expect(isBareRootUrl('https://www.instagram.com/?utm_source=ig')).toBe(true)
    expect(isBareRootUrl('https://www.instagram.com/foo')).toBe(false)
  })

  it('treats an unparseable value as bare — we never publish what we cannot parse', () => {
    expect(isBareRootUrl('not a url')).toBe(true)
    expect(isBareRootUrl('')).toBe(true)
  })

  it('accepts only a Pinkoi storefront path', () => {
    expect(isPinkoiStorefrontUrl('https://www.pinkoi.com/store/guaguaforest')).toBe(true)
    expect(isPinkoiStorefrontUrl('https://www.pinkoi.com/store/guaguaforest/items')).toBe(true)
    expect(isPinkoiStorefrontUrl('https://www.pinkoi.com/')).toBe(false)
    expect(isPinkoiStorefrontUrl('https://www.pinkoi.com/product/abc123')).toBe(false)
    expect(isPinkoiStorefrontUrl('https://www.pinkoi.com/store/')).toBe(false)
    expect(isPinkoiStorefrontUrl('not a url')).toBe(false)
  })
})

describe('buildLinkEnrichPatch — platform roots', () => {
  it.each([
    ['socialInstagram', 'social_instagram', 'https://www.instagram.com/'],
    ['socialInstagram', 'social_instagram', 'https://www.instagram.com'],
    ['socialThreads', 'social_threads', 'https://www.threads.com/'],
    ['socialThreads', 'social_threads', 'https://www.threads.com'],
    ['socialFacebook', 'social_facebook', 'https://www.facebook.com/'],
    ['socialFacebook', 'social_facebook', 'https://www.facebook.com'],
    ['purchaseShopee', 'purchase_shopee', 'https://shopee.tw/'],
    ['purchaseShopee', 'purchase_shopee', 'https://shopee.tw'],
    ['purchasePinkoi', 'purchase_pinkoi', 'https://www.pinkoi.com/'],
    ['purchasePinkoi', 'purchase_pinkoi', 'https://www.pinkoi.com'],
    ['purchaseMyship', 'purchase_myship', 'https://myship.7-11.com.tw/'],
  ] as const)('declines to write the bare root %s -> %s (%s)', (field, column, url) => {
    const scraped: Partial<Record<LinkField, string>> = { [field]: url }
    const patch = buildLinkEnrichPatch({ ...EMPTY_BRAND }, scraped)
    expect(patch[column]).toBeUndefined()
  })

  it('keeps a handle path on the same platform', () => {
    const patch = buildLinkEnrichPatch({ ...EMPTY_BRAND }, {
      socialInstagram: 'https://www.instagram.com/foo',
    })
    expect(patch.social_instagram).toBe('https://www.instagram.com/foo')
  })

  it('rejects a non-storefront Pinkoi path and accepts a storefront', () => {
    expect(
      buildLinkEnrichPatch({ ...EMPTY_BRAND }, {
        purchasePinkoi: 'https://www.pinkoi.com/product/abc123',
      }).purchase_pinkoi,
    ).toBeUndefined()
    expect(
      buildLinkEnrichPatch({ ...EMPTY_BRAND }, {
        purchasePinkoi: 'https://www.pinkoi.com/store/guaguaforest',
      }).purchase_pinkoi,
    ).toBe('https://www.pinkoi.com/store/guaguaforest')
  })

  it('does not reject a bare origin for purchase_website — a brand site IS an origin', () => {
    const patch = buildLinkEnrichPatch({ ...EMPTY_BRAND }, { purchaseWebsite: 'https://brand.com' })
    expect(patch.purchase_website).toBe('https://brand.com')
  })

  it('does not throw on malformed scraped values', () => {
    expect(() =>
      buildLinkEnrichPatch({ ...EMPTY_BRAND }, {
        socialInstagram: 'not a url',
        purchasePinkoi: '://///',
        purchaseWebsite: 'brand dot com',
      }),
    ).not.toThrow()
  })
})

// The refresh run that overwrote a correct, human-verified storefront with the
// platform's front door — its only new information being that Pinkoi exists.
describe('buildLinkEnrichPatch — no specificity downgrade', () => {
  it('keeps pinkoi.com/store/guaguaforest rather than taking pinkoi.com/', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, purchase_pinkoi: 'https://www.pinkoi.com/store/guaguaforest' },
      { purchasePinkoi: 'https://www.pinkoi.com/' },
    )
    expect(patch.purchase_pinkoi).toBeUndefined()
  })

  it('keeps the deeper path on the same host', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, purchase_pinkoi: 'https://www.pinkoi.com/store/guaguaforest/items' },
      { purchasePinkoi: 'https://pinkoi.com/store/guaguaforest' },
    )
    expect(patch.purchase_pinkoi).toBeUndefined()
  })

  it('still allows a cross-host replacement — that carries real new information', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, purchase_website: 'https://oldbrand.myshopify.com/pages/about' },
      { purchaseWebsite: 'https://brand.com' },
    )
    expect(patch.purchase_website).toBe('https://brand.com')
  })

  it('still allows an equally specific change on one host — a genuine rename', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, purchase_pinkoi: 'https://www.pinkoi.com/store/oldname' },
      { purchasePinkoi: 'https://www.pinkoi.com/store/newname' },
    )
    expect(patch.purchase_pinkoi).toBe('https://www.pinkoi.com/store/newname')
  })

  it('still allows a deepening change on one host', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, social_instagram: 'https://www.instagram.com/brand' },
      { socialInstagram: 'https://www.instagram.com/brand/profile' },
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/brand/profile')
  })

  it('leaves the corporate-account branch alone', () => {
    const patch = buildLinkEnrichPatch(
      { ...EMPTY_BRAND, social_instagram: 'https://www.instagram.com/ilovepinkoi/deep/path' },
      { socialInstagram: 'https://www.instagram.com/realbrand' },
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/realbrand')
  })
})

// `facebook.com/threebrothersboards/` — a different company — was published as
// the Taiwanese brand "One Wood"'s Facebook page purely because it ranked.
describe('extractLinksFromUrls — brand identity gate', () => {
  it('behaves identically to before when no brand name is passed', () => {
    expect(extractLinksFromUrls(['https://www.facebook.com/threebrothersboards/'])).toEqual({
      social_facebook: 'https://www.facebook.com/threebrothersboards/',
    })
    expect(extractLinksFromUrls(['https://www.instagram.com/mybrand/'])).toEqual({
      social_instagram: 'https://www.instagram.com/mybrand/',
    })
  })

  it("rejects a stranger's handle and keeps the brand's own", () => {
    expect(
      extractLinksFromUrls(['https://www.facebook.com/threebrothersboards/'], 'One Wood'),
    ).toEqual({})
    expect(extractLinksFromUrls(['https://www.facebook.com/one.wood.100'], 'One Wood')).toEqual({
      social_facebook: 'https://www.facebook.com/one.wood.100',
    })
  })

  it('matches an abbreviated handle contained by a brand token', () => {
    expect(extractLinksFromUrls(['https://www.pinkoi.com/store/guagua'], 'GuaGua Forest')).toEqual({
      purchase_pinkoi: 'https://www.pinkoi.com/store/guagua',
    })
  })

  it('accepts everything when the name has no Latin tokens to discriminate with', () => {
    expect(extractLinksFromUrls(['https://www.instagram.com/chatzutang'], '茶籽堂')).toEqual({
      social_instagram: 'https://www.instagram.com/chatzutang',
    })
  })

  it('does not throw on malformed URLs', () => {
    expect(() => extractLinksFromUrls(['not a url', ''], 'One Wood')).not.toThrow()
    expect(extractLinksFromUrls(['not a url'], 'One Wood')).toEqual({})
  })
})

// DEV-1332: the SERP path has been identity-gated since DEV-1309, but the
// SCRAPE path was not — and that is the one that put @cosme Taiwan's Facebook
// page on five of the brands it stocks, and one illustrator's on 23 brands.
describe('buildLinkEnrichPatch — scraped social identity gate', () => {
  it('behaves identically to before when no brand name is passed', () => {
    expect(
      buildLinkEnrichPatch({ ...EMPTY_BRAND }, {
        socialFacebook: 'https://www.facebook.com/atcosmeTW/',
      }),
    ).toEqual({ social_facebook: 'https://www.facebook.com/atcosmeTW/' })
  })

  it("declines a retailer's social account scraped for a brand it stocks", () => {
    expect(
      buildLinkEnrichPatch(
        { ...EMPTY_BRAND },
        {
          socialFacebook: 'https://www.facebook.com/atcosmeTW/',
          socialInstagram: 'https://www.instagram.com/at_cosmetw/',
        },
        'Just Herb 香草集',
      ),
    ).toEqual({})
  })

  it("keeps the brand's own handle", () => {
    expect(
      buildLinkEnrichPatch(
        { ...EMPTY_BRAND },
        { socialInstagram: 'https://www.instagram.com/annluya_official/' },
        'ANNLUYA 安綠雅',
      ),
    ).toEqual({ social_instagram: 'https://www.instagram.com/annluya_official/' })
  })

  it('leaves an existing correct link untouched rather than nulling it', () => {
    const brand = {
      ...EMPTY_BRAND,
      social_facebook: 'https://www.facebook.com/justherb.tw',
    }
    expect(
      buildLinkEnrichPatch(
        brand,
        { socialFacebook: 'https://www.facebook.com/atcosmeTW/' },
        'Just Herb 香草集',
      ),
    ).toEqual({})
  })

  it('still clears an existing corporate account it cannot replace', () => {
    const brand = {
      ...EMPTY_BRAND,
      social_facebook: 'https://www.facebook.com/ilovepinkoi',
    }
    expect(
      buildLinkEnrichPatch(
        brand,
        { socialFacebook: 'https://www.facebook.com/atcosmeTW/' },
        'Just Herb 香草集',
      ),
    ).toEqual({ social_facebook: null })
  })

  it('does not gate marketplace handles, which are routinely opaque IDs', () => {
    expect(
      buildLinkEnrichPatch(
        { ...EMPTY_BRAND },
        { purchaseShopee: 'https://s.shopee.tw/4VHrii96Af' },
        'Miaoisland 喵島',
      ),
    ).toEqual({ purchase_shopee: 'https://s.shopee.tw/4VHrii96Af' })
  })

  it('accepts anything for a name with no Latin tokens to discriminate with', () => {
    expect(
      buildLinkEnrichPatch(
        { ...EMPTY_BRAND },
        { socialFacebook: 'https://www.facebook.com/Macaoillustrator/' },
        '羊泥工坊',
      ),
    ).toEqual({ social_facebook: 'https://www.facebook.com/Macaoillustrator/' })
  })
})

describe('classifySubmittedUrl', () => {
  it('classifies Instagram URL to socialInstagram', () => {
    const result = classifySubmittedUrl('https://www.instagram.com/mybrand/')
    expect(result).toEqual({ socialInstagram: 'https://www.instagram.com/mybrand/' })
  })

  it('classifies Threads URL to socialThreads', () => {
    const result = classifySubmittedUrl('https://www.threads.net/@mybrand')
    expect(result).toEqual({ socialThreads: 'https://www.threads.net/@mybrand' })
  })

  it('classifies Facebook profile to socialFacebook', () => {
    const result = classifySubmittedUrl('https://www.facebook.com/mybrand')
    expect(result).toEqual({ socialFacebook: 'https://www.facebook.com/mybrand' })
  })

  it('classifies Pinkoi URL to purchasePinkoi', () => {
    const result = classifySubmittedUrl('https://www.pinkoi.com/store/mybrand')
    expect(result).toEqual({ purchasePinkoi: 'https://www.pinkoi.com/store/mybrand' })
  })

  it('classifies Shopee URL to purchaseShopee', () => {
    const result = classifySubmittedUrl('https://shopee.tw/mybrand')
    expect(result).toEqual({ purchaseShopee: 'https://shopee.tw/mybrand' })
  })

  it('classifies regular website to purchaseWebsite', () => {
    const result = classifySubmittedUrl('https://mybrand.com')
    expect(result).toEqual({ purchaseWebsite: 'https://mybrand.com' })
  })

  it('discards corporate account URLs (returns empty)', () => {
    const result = classifySubmittedUrl('https://www.instagram.com/ilovepinkoi/')
    expect(result).toEqual({})
  })

  it('classifies a threads.com profile to socialThreads, not purchaseWebsite', () => {
    expect(classifySubmittedUrl('https://www.threads.com/@mybrand')).toEqual({
      socialThreads: 'https://www.threads.com/@mybrand',
    })
  })

  // The fallback is "it must be their own website" — a platform URL no profile
  // pattern matched is not, and claiming it seeded the bad purchase_website rows.
  it.each([
    'https://www.threads.com/@brand/post/abc',
    'https://linktr.ee/brand',
  ])('does not claim the platform URL %s as a website', (url) => {
    expect(classifySubmittedUrl(url)).toEqual({})
  })
})

describe('buildLinkEnrichPatch — overwrite-with-validation', () => {
  const baseBrand = {
    social_instagram: null, social_threads: null, social_facebook: null,
    purchase_pinkoi: null, purchase_shopee: null, website_url: null,
  }

  it('fills empty fields', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand },
      { social_instagram: 'https://www.instagram.com/mybrand/' }
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('overwrites existing values with new scraped values', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/oldbrand/' },
      { social_instagram: 'https://www.instagram.com/newbrand/' }
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/newbrand/')
  })

  it('skips when new value equals existing (no unnecessary write)', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/mybrand/' },
      { social_instagram: 'https://www.instagram.com/mybrand/' }
    )
    expect(patch.social_instagram).toBeUndefined()
  })

  it('rejects scraped corporate account values', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand },
      { social_instagram: 'https://www.instagram.com/ilovepinkoi/' }
    )
    expect(patch.social_instagram).toBeUndefined()
  })

  it('clears existing corporate value even when no scraped replacement', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/ilovepinkoi/' },
      {}
    )
    expect(patch.social_instagram).toBeNull()
  })
})

describe('buildTextEnrichPatch (unified)', () => {
  it('does not fill description when brand has none', () => {
    const patch = buildTextEnrichPatch(
      { description: null },
      { description: 'A premium handcrafted leather goods brand from Taiwan' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('does not fill description when existing is too short (<20 chars)', () => {
    const patch = buildTextEnrichPatch(
      { description: 'Short desc' },
      { description: 'A premium handcrafted leather goods brand from Taiwan' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('does not overwrite valid existing description', () => {
    const patch = buildTextEnrichPatch(
      { description: 'An existing description that is longer than 20 characters' },
      { description: 'A different scraped description from the website' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('rejects scraped description shorter than 20 chars', () => {
    const patch = buildTextEnrichPatch(
      { description: null },
      { description: 'Too short' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('never writes scraped meta text directly into the description patch', () => {
    const brand = { description: null }
    const scraped = { description: '一段超過二十個字元的網頁 meta 描述，品質未知不可直接入庫' }
    const patch = buildTextEnrichPatch(brand, scraped)
    expect(patch.description).toBeUndefined()
  })
})

describe('buildImageEnrichPatch', () => {
  it('promotes first stored image to hero when brand has none', () => {
    const brand = { heroImageUrl: null, productPhotos: [] }
    const storedUrls = ['https://storage.supabase.co/img1.jpg', 'https://storage.supabase.co/img2.jpg', null]
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(patch.heroImageUrl).toBe('https://storage.supabase.co/img1.jpg')
    expect(patch.productPhotos).toContain('https://storage.supabase.co/img2.jpg')
  })

  it('does not overwrite hero when brand already has one', () => {
    const brand = { heroImageUrl: 'https://existing-hero.jpg', productPhotos: [] }
    const storedUrls = ['https://storage.supabase.co/img1.jpg', 'https://storage.supabase.co/img2.jpg']
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(patch.heroImageUrl).toBeUndefined()
    expect(patch.productPhotos).toContain('https://storage.supabase.co/img2.jpg')
  })

  it('returns empty patch when no stored images', () => {
    const brand = { heroImageUrl: null, productPhotos: [] }
    const storedUrls = [null, null]
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(Object.keys(patch)).toHaveLength(0)
  })
})
