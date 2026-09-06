import { describe, expect, it, vi } from 'vitest'

import {
  toReadPageFetch,
  buildPoolFromRows,
  recordPool,
} from '../products-record'

// ---------------------------------------------------------------------------
// toReadPageFetch
// ---------------------------------------------------------------------------

describe('toReadPageFetch', () => {
  it('wraps fetchHtmlWithMetadata into { text, statusCode }', () => {
    // Null values become safe defaults
    expect(toReadPageFetch({ text: null, status: null })).toEqual({
      text: '',
      statusCode: 0,
    })

    // A 200 passes through
    expect(
      toReadPageFetch({ text: '<html>ok</html>', status: 200 }),
    ).toEqual({
      text: '<html>ok</html>',
      statusCode: 200,
    })
  })
})

// ---------------------------------------------------------------------------
// buildPoolFromRows
// ---------------------------------------------------------------------------

describe('buildPoolFromRows', () => {
  it('maps curated_product_candidates rows of the latest job to ProductCandidate[] and ignores older jobs', () => {
    const rows = [
      // Latest job
      {
        curation_job_id: 'job-2',
        url: 'https://example.com/product-a',
        title: 'Product A',
        image_url: 'https://example.com/a.jpg',
        supplier: 'official_website',
        url_class: 'product-detail',
        search_position: 1,
        created_at: '2026-09-01',
      },
      {
        curation_job_id: 'job-2',
        url: 'https://example.com/product-b?utm_source=fb',
        title: 'Product B',
        image_url: null,
        supplier: 'search',
        url_class: 'listing',
        search_position: 2,
        created_at: '2026-09-01',
      },
      // Older job — should be filtered out
      {
        curation_job_id: 'job-1',
        url: 'https://example.com/old-product',
        title: 'Old Product',
        image_url: null,
        supplier: 'search',
        url_class: 'other',
        search_position: null,
        created_at: '2026-08-01',
      },
    ]

    const pool = buildPoolFromRows(rows)

    // Only the latest job's rows
    expect(pool).toHaveLength(2)

    // First row
    expect(pool[0]!.url).toBe('https://example.com/product-a')
    expect(pool[0]!.normalizedUrl).toBeTruthy()
    expect(pool[0]!.title).toBe('Product A')
    expect(pool[0]!.imageUrl).toBe('https://example.com/a.jpg')
    expect(pool[0]!.supplier).toBe('official_website')
    expect(pool[0]!.urlClass).toBe('product-detail')
    expect(pool[0]!.searchPosition).toBe(1)

    // Second row — normalizedUrl strips utm_source
    expect(pool[1]!.url).toBe('https://example.com/product-b?utm_source=fb')
    expect(pool[1]!.normalizedUrl).not.toContain('utm_source')
    expect(pool[1]!.imageUrl).toBeUndefined()
    expect(pool[1]!.searchPosition).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// recordPool
// ---------------------------------------------------------------------------

describe('recordPool', () => {
  it('reads each selected url through the injected readPage and returns an item body whose input.pool is exactly the recorded subset in recorded order, priorityProductUrls equals that order, status ARCHIVED, humanApproval pending, expectedOutput { decisions: [] }, and one candidate id per recorded url', async () => {
    const brand = { id: 'brand-1', slug: 'test-brand', name: 'Test Brand' }
    const pool = [
      {
        url: 'https://example.com/p1',
        normalizedUrl: 'example.com/p1',
        title: 'P1',
        supplier: 'official_website' as const,
        urlClass: 'product-detail' as const,
        searchPosition: 1,
      },
      {
        url: 'https://example.com/p2',
        normalizedUrl: 'example.com/p2',
        title: 'P2',
        supplier: 'search' as const,
        urlClass: 'listing' as const,
        searchPosition: 2,
      },
    ]

    const evidence = {
      url: 'https://example.com/p1',
      title: 'P1 Title',
      description: null,
      mainText: 'Product content',
      images: [],
      jsonLd: null,
      productSignals: true,
      originExcerpts: [],
      rendered: false,
      statusCode: 200,
    }

    const readPage = vi.fn().mockResolvedValue(evidence)
    let idCounter = 0
    const candidateIdFactory = () => `cand-${++idCounter}`

    const result = await recordPool({
      brand,
      pool,
      priorityUrls: [],
      urlsOverride: undefined,
      readPage,
      candidateIdFactory,
    })

    // readPage called for each selected URL
    expect(readPage).toHaveBeenCalledTimes(2)

    // Body shape
    expect(result.status).toBe('ARCHIVED')
    expect(result.id).toBe('products-agent:test-brand')

    // Input shape
    const input = result.input as {
      kind: string
      brand: typeof brand
      pool: typeof pool
      candidateIdsByUrl: Record<string, string>
      priorityProductUrls: string[]
      evidence: Record<string, unknown>
    }
    expect(input.kind).toBe('products-agent-replay')
    expect(input.brand).toEqual(brand)
    expect(input.pool).toHaveLength(2)
    expect(input.pool[0]!.url).toBe('https://example.com/p1')
    expect(input.pool[1]!.url).toBe('https://example.com/p2')

    // priorityProductUrls matches recorded order
    expect(input.priorityProductUrls).toEqual([
      'https://example.com/p1',
      'https://example.com/p2',
    ])

    // One candidate id per recorded url
    expect(Object.keys(input.candidateIdsByUrl)).toHaveLength(2)
    expect(input.candidateIdsByUrl['https://example.com/p1']).toBe('cand-1')
    expect(input.candidateIdsByUrl['https://example.com/p2']).toBe('cand-2')

    // Evidence recorded
    expect(input.evidence['https://example.com/p1']).toEqual(evidence)

    // expectedOutput
    expect(result.expectedOutput).toEqual({ decisions: [] })

    // metadata
    const meta = result.metadata as {
      humanApproval: { status: string }
      rubricVersion: string
      source: { brandId: string }
    }
    expect(meta.humanApproval).toEqual({ status: 'pending' })
    expect(meta.rubricVersion).toBe('dev-1649-v1')
    expect(meta.source.brandId).toBe('brand-1')
  })

  it('--urls override replaces selectCandidates order and the override becomes the stored pool', async () => {
    // Pool has 3 items; override specifies 2 in a different order
    const brand = { id: 'brand-2', slug: 'override-brand', name: 'Override Brand' }
    const pool = [
      {
        url: 'https://example.com/a',
        normalizedUrl: 'example.com/a',
        title: 'A',
        supplier: 'search' as const,
        urlClass: 'product-detail' as const,
      },
      {
        url: 'https://example.com/b',
        normalizedUrl: 'example.com/b',
        title: 'B',
        supplier: 'search' as const,
        urlClass: 'listing' as const,
      },
      {
        url: 'https://example.com/c',
        normalizedUrl: 'example.com/c',
        title: 'C',
        supplier: 'official_website' as const,
        urlClass: 'product-detail' as const,
      },
    ]

    const evidence = {
      url: '',
      title: null,
      description: null,
      mainText: '',
      images: [],
      jsonLd: null,
      productSignals: false,
      originExcerpts: [],
      rendered: false,
      statusCode: 200,
    }

    const readPage = vi.fn().mockResolvedValue(evidence)
    const candidateIdFactory = () => 'cand-x'

    // Override asks for c then a (skipping b, reordering)
    const result = await recordPool({
      brand,
      pool,
      priorityUrls: [],
      urlsOverride: ['https://example.com/c', 'https://example.com/a'],
      readPage,
      candidateIdFactory,
    })

    const input = result.input as {
      pool: Array<{ url: string }>
      priorityProductUrls: string[]
    }

    // The stored pool is exactly the override order
    expect(input.pool).toHaveLength(2)
    expect(input.pool[0]!.url).toBe('https://example.com/c')
    expect(input.pool[1]!.url).toBe('https://example.com/a')
    expect(input.priorityProductUrls).toEqual([
      'https://example.com/c',
      'https://example.com/a',
    ])
  })
})
