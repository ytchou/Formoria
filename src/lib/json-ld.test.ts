import { describe, it, expect } from 'vitest'
import {
  buildArticleJsonLd,
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  buildCategoryItemListJsonLd,
  buildBrandsItemListJsonLd,
  buildDefinedTermSetJsonLd,
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
  type JsonLdObject,
} from '@/lib/json-ld'
import type { Brand } from '@/lib/types'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: '123', name: '茶籽堂 Chatzutang', slug: 'chatzutang',
    description: 'Natural body care with camellia seed oil',
    heroImageUrl: 'https://example.com/hero.jpg',
    status: 'approved', isVerified: false, isDemo: false, category: 'Food & Beverage', foundingYear: 2004,
    purchaseWebsite: 'https://chatzutang.com',
    purchasePinkoi: 'https://pinkoi.com/chatzutang',
    purchaseShopee: null,
    socialInstagram: 'https://instagram.com/chatzutang',
    socialThreads: null,
    socialFacebook: 'https://facebook.com/chatzutang',
    otherUrls: [],
    retailLocations: [{ name: 'Nanzhuang Store', address: '苗栗縣南庄鄉', latitude: 24.59, longitude: 120.99 }],
    customerVoices: [],
    productPhotos: [],
    siteContent: null,
    priceRange: null,
    productTags: [],
    contactEmail: 'hello@chatzutang.com',
    submittedAt: '2026-01-01T00:00:00Z', approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('buildBrandJsonLd', () => {
  it('returns Organization schema with required fields', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('Organization')
    expect(jsonLd.name).toBe('茶籽堂 Chatzutang')
    expect(jsonLd.url).toBe('https://chatzutang.com')
    expect(jsonLd.logo).toBe('https://example.com/hero.jpg')
    expect(jsonLd.foundingDate).toBe('2004')
  })

  it('includes sameAs array from social links', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.sameAs).toContain('https://instagram.com/chatzutang')
    expect(jsonLd.sameAs).toContain('https://facebook.com/chatzutang')
  })

  it('omits keywords field', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.keywords).toBeUndefined()
  })

  it('includes purchase link URLs in sameAs alongside social links', () => {
    const jsonLd = buildBrandJsonLd(makeBrand({
      purchasePinkoi: 'https://pinkoi.com/chatzutang',
      purchaseShopee: 'https://shopee.tw/chatzutang',
    }))
    expect(jsonLd.sameAs).toContain('https://instagram.com/chatzutang')
    expect(jsonLd.sameAs).toContain('https://facebook.com/chatzutang')
    expect(jsonLd.sameAs).toContain('https://pinkoi.com/chatzutang')
    expect(jsonLd.sameAs).toContain('https://shopee.tw/chatzutang')
  })

  describe('buildBrandJsonLd audit', () => {
    it('never exposes contactEmail as email in the output', () => {
      const withEmail = buildBrandJsonLd(makeBrand({ contactEmail: 'hello@chatzutang.com' }))
      expect(withEmail.email).toBeUndefined()

      const withoutEmail = buildBrandJsonLd(makeBrand({ contactEmail: null }))
      expect(withoutEmail.email).toBeUndefined()
    })

    it('maps heroImageUrl to logo and omits it when null', () => {
      const withHero = buildBrandJsonLd(makeBrand({ heroImageUrl: 'https://example.com/hero.jpg' }))
      expect(withHero.logo).toBe('https://example.com/hero.jpg')

      const withoutHero = buildBrandJsonLd(makeBrand({ heroImageUrl: null }))
      expect(withoutHero.logo).toBeUndefined()
    })

    it('includes all non-null social and purchase URLs in sameAs', () => {
      const jsonLd = buildBrandJsonLd(makeBrand({
        socialInstagram: 'https://instagram.com/chatzutang',
        socialThreads: 'https://threads.net/@chatzutang',
        socialFacebook: 'https://facebook.com/chatzutang',
        purchaseWebsite: 'https://chatzutang.com',
        purchasePinkoi: 'https://pinkoi.com/chatzutang',
        purchaseShopee: 'https://shopee.tw/chatzutang',
        otherUrls: [{ label: 'Blog', url: 'https://example.com/brand' }],
      }))

      expect(jsonLd.sameAs).toEqual([
        'https://instagram.com/chatzutang',
        'https://threads.net/@chatzutang',
        'https://facebook.com/chatzutang',
        'https://chatzutang.com',
        'https://pinkoi.com/chatzutang',
        'https://shopee.tw/chatzutang',
        'https://example.com/brand',
      ])
    })

    it('excludes null and undefined values from sameAs', () => {
      const jsonLd = buildBrandJsonLd(makeBrand({
        socialInstagram: null,
        socialThreads: undefined,
        socialFacebook: null,
        purchaseWebsite: null,
        purchasePinkoi: undefined,
        purchaseShopee: null,
        otherUrls: [{ label: 'Blog', url: '' }, { label: 'Docs', url: 'https://docs.example.com' }],
      } as unknown as Partial<Brand>))

      expect(jsonLd.sameAs).toEqual(['https://docs.example.com'])
    })
  })

  it('includes PostalAddress from first retail location', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '苗栗縣南庄鄉',
    })
  })

  it('includes all retail locations as PostalAddress array when multiple', () => {
    const jsonLd = buildBrandJsonLd(makeBrand({
      retailLocations: [
        { name: 'Nanzhuang Store', address: '苗栗縣南庄鄉', latitude: 24.59, longitude: 120.99 },
        { name: 'Taipei Store', address: '台北市信義區', latitude: 25.03, longitude: 121.56 },
      ],
    }))
    expect(jsonLd.address).toEqual([
      {
        '@type': 'PostalAddress',
        streetAddress: '苗栗縣南庄鄉',
      },
      {
        '@type': 'PostalAddress',
        streetAddress: '台北市信義區',
      },
    ])
  })

  it('keeps single retail location as PostalAddress object (backward-compatible)', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(Array.isArray(jsonLd.address)).toBe(false)
    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '苗栗縣南庄鄉',
    })
  })

  it('omits optional fields when null', () => {
    const jsonLd = buildBrandJsonLd(makeBrand({
      contactEmail: null, socialInstagram: null, socialThreads: null, socialFacebook: null,
      purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null, otherUrls: [],
      retailLocations: [], heroImageUrl: null, foundingYear: null,
    }))
    expect(jsonLd.logo).toBeUndefined()
    expect(jsonLd.foundingDate).toBeUndefined()
    expect(jsonLd.sameAs).toBeUndefined()
    expect(jsonLd.address).toBeUndefined()
  })
})

describe('buildCategoryItemListJsonLd', () => {
  const mockBrands = [
    { name: '茶籽堂', slug: 'cha-zi-tang' },
    { name: 'DAYLILY', slug: 'daylily' },
    { name: '印花樂', slug: 'inblooom' },
  ]

  it('returns valid ItemList JSON-LD', () => {
    const result = buildCategoryItemListJsonLd('美妝', 'beauty', mockBrands)

    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('ItemList')
    expect(result.name).toContain('美妝')
    expect(result.numberOfItems).toBe(3)
  })

  it('generates ListItem entries with correct positions', () => {
    const result = buildCategoryItemListJsonLd('美妝', 'beauty', mockBrands)
    const items = result.itemListElement

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      name: '茶籽堂',
    })
    expect(items[0].url).toContain('/cha-zi-tang')
    expect(items[2].position).toBe(3)
  })

  it('handles empty brands array', () => {
    const result = buildCategoryItemListJsonLd('食品', 'food', [])

    expect(result.numberOfItems).toBe(0)
    expect(result.itemListElement).toEqual([])
  })

  it('uses /brands/:slug for brand item URLs', () => {
    const result = buildCategoryItemListJsonLd('美妝', 'beauty', [
      { name: 'Test', slug: 'test-brand' },
    ])
    expect(result.itemListElement[0].url).toContain('/brands/test-brand')
    expect(result.itemListElement[0].url).not.toMatch(/^https?:\/\/[^/]+\/test-brand$/)
  })
})

describe('buildCategoryItemListJsonLd parentGroup', () => {
  it('adds an about Thing when a parent group is provided', () => {
    const result = buildCategoryItemListJsonLd(
      '服飾',
      'clothing',
      [{ name: 'oqLiq', slug: 'oqliq' }],
      'zh-TW',
      'Taiwan clothing brands',
      'Fashion',
    )

    expect(result.about).toEqual({ '@type': 'Thing', name: 'Fashion' })
  })

  it('omits about when no parent group is provided', () => {
    const result = buildCategoryItemListJsonLd(
      '服飾',
      'clothing',
      [{ name: 'oqLiq', slug: 'oqliq' }],
      'zh-TW',
      'Taiwan clothing brands',
      undefined,
    )

    expect('about' in result).toBe(false)
  })
})

describe('buildBreadcrumbJsonLd', () => {
  it('builds BreadcrumbList with correct positions', () => {
    const items = [
      { label: 'Brands', href: '/' },
      { label: 'Food & Beverage', href: '/?category=Food+%26+Beverage' },
      { label: '茶籽堂 Chatzutang' },
    ]
    const jsonLd = buildBreadcrumbJsonLd(items)
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('BreadcrumbList')
    expect(jsonLd.itemListElement).toHaveLength(3)
    expect(jsonLd.itemListElement[0].position).toBe(1)
    expect(jsonLd.itemListElement[2].position).toBe(3)
  })

  it('omits item URL for the last breadcrumb (current page)', () => {
    const items = [{ label: 'Brands', href: '/' }, { label: 'Brand Name' }]
    const jsonLd = buildBreadcrumbJsonLd(items)
    expect(jsonLd.itemListElement[0].item).toBeDefined()
    expect(jsonLd.itemListElement[1].item).toBeUndefined()
  })
})

describe('buildFaqPageJsonLd', () => {
  it('returns FAQPage schema with correct @context and @type', () => {
    const items = [{ question: '什麼是 Formoria？', answer: 'Formoria 是台灣品牌目錄。' }]
    const result = buildFaqPageJsonLd(items)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('FAQPage')
  })

  it('maps each item to a Question/Answer entity', () => {
    const items = [{ question: '什麼是 Formoria？', answer: 'Formoria 是台灣品牌目錄。' }]
    const result = buildFaqPageJsonLd(items)
    expect((result.mainEntity as unknown[]).length).toBe(1)
    expect((result.mainEntity as unknown[])[0]).toEqual({
      '@type': 'Question',
      name: '什麼是 Formoria？',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Formoria 是台灣品牌目錄。',
      },
    })
  })

  it('maps all items in the correct order', () => {
    const items = [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' },
    ]
    const result = buildFaqPageJsonLd(items)
    const entities = result.mainEntity as Array<{ name: string }>
    expect(entities).toHaveLength(3)
    expect(entities[2].name).toBe('Q3')
  })

  it('returns empty mainEntity for empty items array', () => {
    const result = buildFaqPageJsonLd([])
    expect(result.mainEntity).toEqual([])
  })
})

describe('buildBrandsItemListJsonLd', () => {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://formoria.com'

  it('returns valid ItemList schema with correct structure', () => {
    expect(siteUrl).toBeTruthy()
    const brands = [
      { name: 'Brand Alpha', slug: 'brand-alpha' },
      { name: 'Brand Beta', slug: 'brand-beta' },
    ]
    const result = buildBrandsItemListJsonLd(brands)

    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('ItemList')
    expect(result.itemListElement).toHaveLength(2)
    expect(result.numberOfItems).toBe(brands.length)
    expect(result.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      name: 'Brand Alpha',
    })
    expect(result.itemListElement[0].url).toContain('/brands/brand-alpha')
    expect(result.itemListElement[1].position).toBe(2)
  })

  it('returns empty itemListElement for empty brands array', () => {
    const result = buildBrandsItemListJsonLd([])
    expect(result['@type']).toBe('ItemList')
    expect(result.itemListElement).toHaveLength(0)
  })

  it('defaults to zh-TW locale', () => {
    const result = buildBrandsItemListJsonLd([{ name: 'X', slug: 'x' }])
    expect(result.inLanguage).toBe('zh-TW')
  })

  it('respects explicit locale parameter', () => {
    const result = buildBrandsItemListJsonLd([{ name: 'X', slug: 'x' }], 'en')
    expect(result.inLanguage).toBe('en')
  })

  it('generates correct URLs with locale prefix for en', () => {
    const result = buildBrandsItemListJsonLd([{ name: 'X', slug: 'x' }], 'en')
    expect(result.itemListElement[0].url).toContain('/en/brands/x')
  })
})

describe('buildWebSiteJsonLd', () => {
  it('returns WebSite schema with correct structure', () => {
    const jsonLd = buildWebSiteJsonLd()
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('WebSite')
    expect(jsonLd.name).toBe('Formoria')
    expect(jsonLd.alternateName).toBeUndefined()
    expect(jsonLd.url).toBeDefined()
    expect(jsonLd.url).toContain('localhost:3000')
    expect(jsonLd.url).not.toContain('mitmap')
  })

  it('includes SearchAction with search URL template', () => {
    const jsonLd = buildWebSiteJsonLd()
    expect(jsonLd.potentialAction['@type']).toBe('SearchAction')
    expect(jsonLd.potentialAction.target.urlTemplate).toContain('search=')
    expect(jsonLd.potentialAction['query-input']).toContain(
      'search_term_string'
    )
  })

  it('SearchAction targets /brands?search= not /?search=', () => {
    const jsonLd = buildWebSiteJsonLd()
    const urlTemplate = jsonLd.potentialAction.target.urlTemplate
    expect(urlTemplate).toContain('/brands?search=')
    expect(urlTemplate).not.toContain('/?search=')
  })
})

describe('buildOrganizationJsonLd', () => {
  it('emits an Organization with name and absolute url', () => {
    const ld = buildOrganizationJsonLd('zh-TW') as JsonLdObject
    expect(ld['@type']).toBe('Organization')
    expect(ld.name).toBe('Formoria')
    expect(ld.url).toMatch(/^https?:\/\//)
  })
  it('omits sameAs when no socials are configured', () => {
    const ld = buildOrganizationJsonLd('en') as JsonLdObject
    expect('sameAs' in ld).toBe(false)
  })
})

describe('buildArticleJsonLd', () => {
  it('emits an Article with headline and publisher Organization', () => {
    const ld = buildArticleJsonLd({ title: 'About', description: 'desc', path: '/about', locale: 'zh-TW' }) as JsonLdObject
    expect(ld['@type']).toBe('Article')
    expect(ld.headline).toBe('About')
    expect(ld.publisher['@type']).toBe('Organization')
  })
})

describe('buildDefinedTermSetJsonLd', () => {
  it('emits a DefinedTermSet with DefinedTerm members', () => {
    const ld = buildDefinedTermSetJsonLd(
      [{ name: '台灣製造', description: 'Made in Taiwan' }],
      'zh-TW',
    ) as JsonLdObject
    expect(ld['@type']).toBe('DefinedTermSet')
    expect(ld.hasDefinedTerm[0]['@type']).toBe('DefinedTerm')
    expect(ld.hasDefinedTerm[0].name).toBe('台灣製造')
  })
})

describe('safeJsonLdStringify', () => {
  it('produces valid JSON', () => {
    const data = { name: 'Test Brand', description: 'A brand' }
    const result = safeJsonLdStringify(data)
    expect(JSON.parse(result)).toEqual(data)
  })

  it('escapes script-closing sequences', () => {
    const data = { name: '</script><script>alert(1)</script>' }
    const result = safeJsonLdStringify(data)
    expect(result).not.toContain('</script>')
    expect(result).toContain('\\u003c')
    expect(JSON.parse(result)).toEqual(data)
  })

  it('preserves CJK characters and emoji', () => {
    const data = { name: '茶籽堂 🌿' }
    const result = safeJsonLdStringify(data)
    expect(JSON.parse(result)).toEqual(data)
  })
})
