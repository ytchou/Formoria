import { describe, it, expect } from 'vitest'
import { filterBrandsByTags, parseTagSlugsFromParam, serializeTagSlugsToParam } from './filter-brands'
import type { Brand, TaxonomyTag } from '@/lib/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTag(slug: string, category: TaxonomyTag['category'] = 'product_type'): TaxonomyTag {
  return {
    id: slug,
    name: slug,
    nameZh: null,
    slug,
    category,
    isActive: true,
    suggestedBy: null,
    createdAt: '2024-01-01T00:00:00Z',
  }
}

function makeBrand(id: string, tags: TaxonomyTag[]): Brand {
  return {
    id,
    name: `Brand ${id}`,
    slug: `brand-${id}`,
    description: null,
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    tags,
    submittedAt: '2024-01-01T00:00:00Z',
    approvedAt: '2024-01-02T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// filterBrandsByTags
// ---------------------------------------------------------------------------

describe('filterBrandsByTags', () => {
  const tagA = makeTag('clothing')
  const tagB = makeTag('leather', 'material')
  const tagC = makeTag('handmade', 'material')

  const brandAlpha = makeBrand('alpha', [tagA, tagB])
  const brandBeta = makeBrand('beta', [tagA])
  const brandGamma = makeBrand('gamma', [tagC])
  const brandDelta = makeBrand('delta', [])

  const allBrands = [brandAlpha, brandBeta, brandGamma, brandDelta]

  it('returns all brands when no slugs are selected', () => {
    expect(filterBrandsByTags(allBrands, [])).toEqual(allBrands)
  })

  it('returns only brands that have at least one matching tag slug', () => {
    const result = filterBrandsByTags(allBrands, ['clothing'])
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.id)).toEqual(['alpha', 'beta'])
  })

  it('returns brands matching any of multiple selected slugs (OR logic)', () => {
    const result = filterBrandsByTags(allBrands, ['clothing', 'handmade'])
    expect(result).toHaveLength(3)
    expect(result.map((b) => b.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('excludes brands with no matching tags', () => {
    const result = filterBrandsByTags(allBrands, ['leather'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('alpha')
  })

  it('returns empty array when no brands match', () => {
    const result = filterBrandsByTags(allBrands, ['nonexistent-slug'])
    expect(result).toHaveLength(0)
  })

  it('returns empty array when brands list is empty', () => {
    const result = filterBrandsByTags([], ['clothing'])
    expect(result).toHaveLength(0)
  })

  it('excludes brands that have no tags even with no filter', () => {
    // delta has no tags; with no filter, all brands including delta are returned
    const result = filterBrandsByTags(allBrands, [])
    expect(result).toContainEqual(brandDelta)
  })
})

// ---------------------------------------------------------------------------
// parseTagSlugsFromParam
// ---------------------------------------------------------------------------

describe('parseTagSlugsFromParam', () => {
  it('returns empty array for null', () => {
    expect(parseTagSlugsFromParam(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseTagSlugsFromParam('')).toEqual([])
  })

  it('parses a single slug', () => {
    expect(parseTagSlugsFromParam('clothing')).toEqual(['clothing'])
  })

  it('parses multiple comma-separated slugs', () => {
    expect(parseTagSlugsFromParam('clothing,leather,handmade')).toEqual([
      'clothing',
      'leather',
      'handmade',
    ])
  })

  it('trims whitespace from slugs', () => {
    expect(parseTagSlugsFromParam(' clothing , leather ')).toEqual(['clothing', 'leather'])
  })

  it('deduplicates repeated slugs', () => {
    expect(parseTagSlugsFromParam('clothing,clothing,leather')).toEqual(['clothing', 'leather'])
  })

  it('filters out empty segments from trailing/leading commas', () => {
    expect(parseTagSlugsFromParam(',clothing,')).toEqual(['clothing'])
  })
})

// ---------------------------------------------------------------------------
// serializeTagSlugsToParam
// ---------------------------------------------------------------------------

describe('serializeTagSlugsToParam', () => {
  it('returns null for empty array', () => {
    expect(serializeTagSlugsToParam([])).toBeNull()
  })

  it('returns null for array with only empty strings', () => {
    expect(serializeTagSlugsToParam(['', ''])).toBeNull()
  })

  it('serializes a single slug', () => {
    expect(serializeTagSlugsToParam(['clothing'])).toBe('clothing')
  })

  it('serializes multiple slugs as comma-separated string', () => {
    expect(serializeTagSlugsToParam(['clothing', 'leather'])).toBe('clothing,leather')
  })

  it('deduplicates repeated slugs', () => {
    expect(serializeTagSlugsToParam(['clothing', 'clothing', 'leather'])).toBe(
      'clothing,leather'
    )
  })
})
