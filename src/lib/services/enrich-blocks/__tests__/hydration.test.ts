import { describe, expect, it } from 'vitest'
import { toAcquireCarry } from '../phase-outputs'
import type { AcquirePhaseOutput } from '../../enrich-phases/acquire'
import {
  hydrateScrapedData,
  hydrateCatalogResult,
  hydrateAcquireInputs,
  restoreAcquireCheckpoint,
  type HydrationLoaders,
} from '../hydration'

// ---------------------------------------------------------------------------
// hydrateScrapedData
// ---------------------------------------------------------------------------

describe('rebuilds_scraped_data_from_loaders', () => {
  it('returns perSourceText keyed by URL, snippets, and imageSources', async () => {
    const loaders: HydrationLoaders = {
      loadScrapeStructure: async () => ({
        'https://example.com/about': {
          title: 'About Us',
          description: 'We make things.',
          story: 'Founded in 2020.',
        },
        'https://example.com/products': {
          title: 'Products',
          description: 'Our products.',
          story: undefined,
        },
      }),
      loadSearchRows: async () => [
        {
          url: 'https://example.com/about',
          snippets: ['snippet-about'],
        },
        {
          url: 'https://example.com/products',
          snippets: ['snippet-products'],
        },
      ],
      loadImageSources: async () => [
        {
          source_url: 'https://example.com/img-1.jpg',
          provider_metadata: { pageUrl: 'https://example.com/about' },
        },
      ],
    }

    const result = await hydrateScrapedData(
      { type: 'brand', id: 'brand-1' },
      loaders,
    )

    expect(result.perSourceText).toEqual({
      'https://example.com/about': {
        title: 'About Us',
        description: 'We make things.',
        story: 'Founded in 2020.',
      },
      'https://example.com/products': {
        title: 'Products',
        description: 'Our products.',
        story: undefined,
      },
    })
    expect(result.snippets).toEqual(['snippet-about', 'snippet-products'])
    expect(result.imageSources).toEqual([
      {
        source_url: 'https://example.com/img-1.jpg',
        provider_metadata: { pageUrl: 'https://example.com/about' },
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// hydrateCatalogResult
// ---------------------------------------------------------------------------

describe('rebuilds_catalog_evidence_from_catalog_rows', () => {
  it('returns a Map keyed by normalized URL from catalog rows plus carry triples', async () => {
    const carry = {
      catalog: {
        triples: [
          {
            url: 'https://example.com/product-1',
            title: 'Product 1',
            imageUrl: 'https://example.com/img-1.jpg',
            platform: 'generic' as const,
            supplier: 'example',
            sourceUrl: 'https://example.com/catalog',
            sourcePosition: 0,
          },
        ],
        attempts: [],
        deadlineHit: false,
      },
      acquisitionPageUrls: [],
      priorityProductUrls: [],
      officialNameCandidates: [],
      scrapedImageSources: [],
    }

    const loaders: HydrationLoaders = {
      loadScrapeStructure: async () => ({}),
      loadSearchRows: async () => [],
      loadImageSources: async () => [],
      loadCatalogRows: async () => [
        {
          url: 'https://example.com/product-1',
          raw_response: {
            url: 'https://example.com/product-1',
            title: 'Product 1',
            titleSource: 'og',
            text: 'Description of product 1',
            imageUrls: ['https://example.com/img-1.jpg'],
          },
          snippets: ['Description of product 1'],
        },
        {
          url: 'https://example.com/product-2',
          raw_response: {
            url: 'https://example.com/product-2',
            title: 'Product 2',
            titleSource: 'h1',
            text: 'Description of product 2',
            imageUrls: [],
          },
          snippets: ['Description of product 2'],
        },
      ],
    }

    const result = await hydrateCatalogResult(
      carry,
      { type: 'brand', id: 'brand-1' },
      loaders,
    )

    expect(result.triples).toEqual(carry.catalog.triples)
    expect(result.attempts).toEqual(carry.catalog.attempts)
    expect(result.deadlineHit).toBe(false)
    // Evidence should be a Map with entries from catalog rows
    expect(result.evidence).toBeInstanceOf(Map)
    expect(result.evidence.get('https://example.com/product-1')).toEqual({
      title: 'Product 1',
      titleSource: 'og',
      text: 'Description of product 1',
      imageUrls: ['https://example.com/img-1.jpg'],
    })
    expect(result.evidence.get('https://example.com/product-2')).toEqual({
      title: 'Product 2',
      titleSource: 'h1',
      text: 'Description of product 2',
      imageUrls: [],
    })
  })
})

// ---------------------------------------------------------------------------
// hydrateAcquireInputs
// ---------------------------------------------------------------------------

describe('acquire_result_shape_matches_in_run_shape', () => {
  it('the hydrated object satisfies the same subset the products/names blocks consume', async () => {
    const loaders: HydrationLoaders = {
      loadScrapeStructure: async () => ({
        'https://example.com/about': {
          title: 'Brand Name',
          description: 'We are a brand.',
          story: undefined,
        },
      }),
      loadSearchRows: async () => [
        { url: 'https://example.com/about', snippets: ['We are a brand.'] },
      ],
      loadImageSources: async () => [
        {
          source_url: 'https://example.com/hero.jpg',
          provider_metadata: { pageUrl: 'https://example.com/about' },
        },
      ],
      loadCatalogRows: async () => [
        {
          url: 'https://example.com/product-1',
          raw_response: {
            url: 'https://example.com/product-1',
            title: 'Product 1',
            titleSource: 'og',
            text: 'A nice product.',
            imageUrls: ['https://example.com/product-1.jpg'],
          },
          snippets: ['A nice product.'],
        },
      ],
    }

    const carry = {
      catalog: {
        triples: [
          {
            url: 'https://example.com/product-1',
            title: 'Product 1',
            imageUrl: 'https://example.com/product-1.jpg',
            platform: 'generic' as const,
            supplier: 'example',
            sourceUrl: 'https://example.com/catalog',
            sourcePosition: 0,
          },
        ],
        attempts: [],
        deadlineHit: false,
      },
      acquisitionPageUrls: ['https://example.com/about'],
      priorityProductUrls: ['https://example.com/product-1'],
      officialNameCandidates: [
        { source: 'official_website' as const, value: 'Brand Name', evidence: [] },
      ],
      scrapedImageSources: [
        { url: 'https://example.com/hero.jpg', method: 'crawl', pageUrl: 'https://example.com/about', position: 0 },
      ],
    }

    const result = await hydrateAcquireInputs(
      carry,
      { type: 'brand', id: 'brand-1' },
      loaders,
    )

    // Must have the fields that products and names blocks read
    expect(result.scrapedData).toBeDefined()
    expect(result.scrapedData.perSourceText).toBeDefined()
    expect(result.scrapedData.snippets).toBeDefined()
    expect(result.catalogResult).toBeDefined()
    expect(result.catalogResult!.evidence).toBeInstanceOf(Map)
    expect(result.officialNameCandidates).toEqual(carry.officialNameCandidates)
    expect(result.acquisitionPageUrls).toEqual(carry.acquisitionPageUrls)
    expect(result.priorityProductUrls).toEqual(carry.priorityProductUrls)
    expect(result.scrapedImageSources).toEqual(carry.scrapedImageSources)
  })
})

it('a resumed target retains its acquired page evidence after checkpoint serialization', () => {
  const pageUrl = 'https://ceramic-studio.tw/products/tea-cup'
  const acquired: AcquirePhaseOutput = {
    phaseResult: { phase: 'acquire', status: 'succeeded', changedFields: [], durationMs: 120 },
    patch: { purchase_website: 'https://ceramic-studio.tw' },
    scrapedBrandName: '陶作工作室',
    officialNameCandidates: [{ source: 'official_website', value: '陶作工作室', evidence: [] }],
    scrapedData: { description: '手工製作的陶杯，於鶯歌燒製。' },
    scrapedImageUrls: [], scrapedImageSources: [], jsonLdImageUrls: [],
    quarantine: {}, imagePool: [], acquisitionPageUrls: [pageUrl],
    priorityProductUrls: [pageUrl], revokedColumns: [], providerFailure: false,
    catalogResult: {
      triples: [], attempts: [], deadlineHit: false,
      evidence: new Map([[pageUrl, { title: '手作茶杯', titleSource: 'h1', text: '鶯歌製陶', imageUrls: [] }]]),
    },
  }
  const restored = restoreAcquireCheckpoint(JSON.parse(JSON.stringify(toAcquireCarry(acquired))))
  expect(restored).toEqual(acquired)
  const withoutCatalog = { ...acquired, catalogResult: undefined }
  expect(restoreAcquireCheckpoint(JSON.parse(JSON.stringify(toAcquireCarry(withoutCatalog))))).toEqual(withoutCatalog)
})

it('rejects a checkpoint missing the acquisition inputs needed by downstream phases', () => {
  const incomplete = {
    catalog: { triples: [], attempts: [], deadlineHit: false },
    catalogEvidence: [], result: { phaseResult: { phase: 'acquire', status: 'succeeded' } },
  }
  expect(restoreAcquireCheckpoint(JSON.parse(JSON.stringify(incomplete)))).toBeUndefined()
})
