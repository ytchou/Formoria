import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  triageBrandsBatch,
  type TriageBatchItem,
  type TriageResult,
} from '../product-type-classifier'

const mockFetch = vi.fn()
void (null as TriageResult | null)

describe('triageBrandsBatch', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const brands: TriageBatchItem[] = [
    { slug: 'my-brand', name: 'My Brand', description: 'Handmade soap', website: 'https://mybrand.com' },
    { slug: 'some-reseller', name: '代購小舖', description: null, website: null },
  ]

  it('returns triage results for each brand in the batch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              { slug: 'my-brand', isNonBrand: false, nonBrandReason: null, slug_generated: 'my-brand', productType: 'beauty', confidence: 'high' },
              { slug: 'some-reseller', isNonBrand: true, nonBrandReason: '代購 (reseller)', slug_generated: 'some-reseller', productType: null, confidence: 'high' },
            ]),
          },
        }],
      }),
    })

    const results = await triageBrandsBatch(brands)

    expect(results.size).toBe(2)

    const myBrand = results.get('my-brand')
    expect(myBrand).toBeDefined()
    expect(myBrand!.isNonBrand).toBe(false)
    expect(myBrand!.productType).toBe('beauty')
    expect(myBrand!.slug).toBe('my-brand')
    expect(myBrand!.slugGenerated).toBe('my-brand')
    expect(myBrand!.confidence).toBe('high')

    const reseller = results.get('some-reseller')
    expect(reseller).toBeDefined()
    expect(reseller!.isNonBrand).toBe(true)
    expect(reseller!.nonBrandReason).toBe('代購 (reseller)')
    expect(reseller!.slugGenerated).toBe('some-reseller')
  })

  it('falls back to individual calls when batch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({ isNonBrand: false, slug_generated: 'my-brand', productType: 'beauty', confidence: 'high' }),
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({ isNonBrand: true, nonBrandReason: 'reseller', slug_generated: 'some-reseller', productType: null, confidence: 'high' }),
            },
          }],
        }),
      })

    const results = await triageBrandsBatch(brands)
    expect(results.size).toBe(2)
  })

  it('chunks brands into batches of 20', async () => {
    const largeBatch: TriageBatchItem[] = Array.from({ length: 25 }, (_, i) => ({
      slug: `brand-${i}`,
      name: `Brand ${i}`,
      description: null,
      website: null,
    }))

    const makeResponse = (count: number) => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify(
              Array.from({ length: count }, (_, i) => ({
                slug: `brand-${i}`,
                isNonBrand: false,
                slug_generated: `brand-${i}`,
                productType: 'crafts',
                confidence: 'medium',
              }))
            ),
          },
        }],
      }),
    })

    mockFetch
      .mockResolvedValueOnce(makeResponse(20))
      .mockResolvedValueOnce(makeResponse(5))

    const results = await triageBrandsBatch(largeBatch)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(results.size).toBe(25)
  })
})
