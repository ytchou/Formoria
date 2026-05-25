import { describe, it, expect } from 'vitest'
import { buildBrandJsonLd, buildBreadcrumbJsonLd, buildCategoryItemListJsonLd, buildWebSiteJsonLd, buildFaqPageJsonLd } from './json-ld'
import type { Brand } from '@/lib/types'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: '123', name: '茶籽堂 Chatzutang', slug: 'chatzutang',
    description: 'Natural body care with camellia seed oil',
    logoUrl: 'https://example.com/logo.png',
    heroImageUrl: 'https://example.com/hero.jpg',
    status: 'approved', isVerified: false, category: 'Food & Beverage', foundingYear: 2004,
    purchaseLinks: [{ platform: 'Pinkoi', url: 'https://pinkoi.com/chatzutang', label: 'Pinkoi' }],
    socialLinks: {
      officialWebsite: 'https://chatzutang.com',
      instagram: 'https://instagram.com/chatzutang',
      facebook: 'https://facebook.com/chatzutang',
    },
    retailLocations: [{ name: 'Nanzhuang Store', address: '苗栗縣南庄鄉', latitude: 24.59, longitude: 120.99 }],
    productPhotos: [], brandHighlights: null,
    contactEmail: 'hello@chatzutang.com',
    founder: { name: '趙文豪', title: 'Founder', avatarUrl: null, quote: null },
    tags: [],
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
    expect(jsonLd.logo).toBe('https://example.com/logo.png')
    expect(jsonLd.foundingDate).toBe('2004')
  })

  it('includes sameAs array from social links', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.sameAs).toContain('https://instagram.com/chatzutang')
    expect(jsonLd.sameAs).toContain('https://facebook.com/chatzutang')
  })

  it('includes PostalAddress from first retail location', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '苗栗縣南庄鄉',
    })
  })

  it('includes founder as Person schema', () => {
    const jsonLd = buildBrandJsonLd(makeBrand())
    expect(jsonLd.founder).toEqual({
      '@type': 'Person',
      name: '趙文豪',
      jobTitle: 'Founder',
    })
  })

  it('omits optional fields when null', () => {
    const jsonLd = buildBrandJsonLd(makeBrand({
      logoUrl: null, heroImageUrl: null, foundingYear: null,
      contactEmail: null, socialLinks: {}, retailLocations: [], founder: null,
    }))
    expect(jsonLd.logo).toBeUndefined()
    expect(jsonLd.image).toBeUndefined()
    expect(jsonLd.foundingDate).toBeUndefined()
    expect(jsonLd.sameAs).toBeUndefined()
    expect(jsonLd.address).toBeUndefined()
    expect(jsonLd.founder).toBeUndefined()
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
    const items = [{ question: '什麼是 MIT Map？', answer: 'MIT Map 是台灣品牌目錄。' }]
    const result = buildFaqPageJsonLd(items)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('FAQPage')
  })

  it('maps each item to a Question/Answer entity', () => {
    const items = [{ question: '什麼是 MIT Map？', answer: 'MIT Map 是台灣品牌目錄。' }]
    const result = buildFaqPageJsonLd(items)
    expect((result.mainEntity as unknown[]).length).toBe(1)
    expect((result.mainEntity as unknown[])[0]).toEqual({
      '@type': 'Question',
      name: '什麼是 MIT Map？',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'MIT Map 是台灣品牌目錄。',
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

describe('buildWebSiteJsonLd', () => {
  it('returns WebSite schema with correct structure', () => {
    const jsonLd = buildWebSiteJsonLd()
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('WebSite')
    expect(jsonLd.name).toBe('MIT Map')
    expect(jsonLd.url).toBeDefined()
  })

  it('includes SearchAction with search URL template', () => {
    const jsonLd = buildWebSiteJsonLd()
    expect(jsonLd.potentialAction['@type']).toBe('SearchAction')
    expect(jsonLd.potentialAction.target.urlTemplate).toContain('search=')
    expect(jsonLd.potentialAction['query-input']).toContain(
      'search_term_string'
    )
  })

  it('includes Chinese alternate name', () => {
    const jsonLd = buildWebSiteJsonLd()
    expect(jsonLd.alternateName).toBeDefined()
    expect(typeof jsonLd.alternateName).toBe('string')
  })

  it('SearchAction targets /brands?search= not /?search=', () => {
    const jsonLd = buildWebSiteJsonLd()
    const urlTemplate = jsonLd.potentialAction.target.urlTemplate
    expect(urlTemplate).toContain('/brands?search=')
    expect(urlTemplate).not.toContain('/?search=')
  })
})
