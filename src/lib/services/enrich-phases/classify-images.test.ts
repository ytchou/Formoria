import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuditedOpenAIClient } from '../llm-audit'
import {
  applyClassifications,
  getUnclassifiedImages,
  parseClassification,
  parseClassificationBatch,
  resetImageTags,
  runClassifyImagesPhase,
} from './classify-images'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  deleteStoredImagePaths: vi.fn(),
  syncHeroDenormalized: vi.fn(),
}))

vi.mock('../llm-audit', () => ({ createAuditedOpenAIClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('../image-upload', () => ({ deleteStoredImagePaths: mocks.deleteStoredImagePaths }))
vi.mock('../brand-images', () => ({ syncHeroDenormalized: mocks.syncHeroDenormalized }))

describe('parseClassification', () => {
  it('parses a vision response into tags/score/alt', () => {
    const r = parseClassification('{tag:product,score:88,alt_zh:木製餐盤,alt_en:Wooden plate}')
    expect(r).toEqual({ tag: 'product', score: 88, altZh: '木製餐盤', altEn: 'Wooden plate' })
  })
  it('parses strict JSON from GPT-4o-mini', () => {
    const r = parseClassification('{"tag":"lifestyle","score":72,"alt_zh":"戶外背包","alt_en":"Outdoor backpack"}')
    expect(r).toEqual({ tag: 'lifestyle', score: 72, altZh: '戶外背包', altEn: 'Outdoor backpack' })
  })
  it('localizes zh-TW alt text', () => {
    const r = parseClassification('{"tag":"product","score":88,"alt_zh":"視頻質量很高","alt_en":"High-quality video"}')
    expect(r?.altZh).toBe('影片品質很高')
  })
  it('returns null classification (not a throw) on malformed response', () => {
    expect(parseClassification('cannot classify')).toBeNull()
  })
})

describe('parseClassificationBatch', () => {
  it('parses a bare JSON array', () => {
    const input = '[{"tag":"product","score":85,"alt_zh":"背包","alt_en":"Backpack"}]'
    const results = parseClassificationBatch(input, 1)
    expect(results).toHaveLength(1)
    expect(results[0]?.tag).toBe('product')
  })
  it('unwraps object-wrapped array from OpenAI JSON mode', () => {
    const input = '{"classifications":[{"tag":"lifestyle","score":72,"alt_zh":"戶外","alt_en":"Outdoor"},{"tag":"packaging","score":60,"alt_zh":"盒裝","alt_en":"Box"}]}'
    const results = parseClassificationBatch(input, 2)
    expect(results).toHaveLength(2)
    expect(results[0]?.tag).toBe('lifestyle')
    expect(results[1]?.tag).toBe('packaging')
  })
  it('localizes zh-TW alt text in batches', () => {
    const input = '{"classifications":[{"tag":"product","score":85,"alt_zh":"視頻質量很高","alt_en":"High-quality video"}]}'
    const results = parseClassificationBatch(input, 1)
    expect(results[0]?.altZh).toBe('影片品質很高')
  })
  it('handles flat object for single-image batch', () => {
    const input = '{"tag":"product","score":90,"alt_zh":"登山背包","alt_en":"Hiking backpack"}'
    const results = parseClassificationBatch(input, 1)
    expect(results).toHaveLength(1)
    expect(results[0]?.tag).toBe('product')
    expect(results[0]?.score).toBe(90)
  })
  it('returns nulls on non-JSON input', () => {
    const results = parseClassificationBatch('not json', 3)
    expect(results).toEqual([null, null, null])
  })
})

describe('applyClassifications', () => {
  it('rejects junk tags and orders the rest by score; hero = best product/lifestyle', () => {
    const images = [
      { id: '1', tag: 'promo', score: 95 },
      { id: '2', tag: 'product', score: 80 },
      { id: '3', tag: 'lifestyle', score: 90 },
    ]
    const result = applyClassifications(images as never)
    expect(result.rejectedIds).toEqual(['1'])
    expect(result.ordered.map((i) => i.id)).toEqual(['3', '2'])
  })

  it('returns storage paths to delete for rejected images', () => {
    const images = [
      { id: '1', tag: 'promo', score: 95, storage_path: 'brands/b/x.jpg' },
      { id: '2', tag: 'product', score: 80, storage_path: 'brands/b/y.jpg' },
      { id: '3', tag: null, score: 0, storage_path: null },
    ]

    const result = applyClassifications(images as never)

    expect(result.pathsToDelete).toEqual(['brands/b/x.jpg'])
    expect(result.rejectedUpdates).toEqual([
      { id: '1', row: { status: 'rejected', storage_path: null } },
      { id: '3', row: { status: 'rejected', storage_path: null } },
    ])
  })
})

describe('classification query filters', () => {
  it('getUnclassifiedImages query excludes owner-sourced images', async () => {
    const filters: Array<[string, string, unknown]> = []
    const query = {
      eq(column: string, value: string) {
        filters.push(['eq', column, value])
        return this
      },
      neq(column: string, value: string) {
        filters.push(['neq', column, value])
        return this
      },
      is(column: string, value: null) {
        filters.push(['is', column, value])
        return this
      },
      async order() {
        return { data: [], error: null }
      },
    }
    const supabase = {
      from() {
        return {
          select() {
            return query
          },
        }
      },
    }

    await getUnclassifiedImages(supabase, { type: 'brand', id: 'brand-1' })

    expect(filters).toContainEqual(['neq', 'source', 'owner'])
  })

  it('resetImageTags only re-queues active rows and never owner rows', async () => {
    const filters: Array<[string, string, unknown]> = []
    const query = {
      eq(column: string, value: string) {
        filters.push(['eq', column, value])
        return this
      },
      neq(column: string, value: string) {
        filters.push(['neq', column, value])
        return this
      },
      not(column: string, operator: string, value: unknown) {
        filters.push(['not', column, [operator, value]])
        return this
      },
      async select() {
        return { data: [], error: null }
      },
    }
    const supabase = {
      from() {
        return {
          update() {
            return query
          },
        }
      },
    }

    await resetImageTags(supabase, { type: 'brand', id: 'brand-1' })

    expect(filters).toContainEqual(['eq', 'status', 'active'])
    expect(filters).toContainEqual(['neq', 'source', 'owner'])
  })
})

describe('runClassifyImagesPhase auditing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the audited client with job context and does not insert a raw result directly', async () => {
    const image = {
      id: 'image-1',
      url: 'https://images.example/acme-product.webp',
      source: 'search',
      status: 'active',
      tags: null,
      score: null,
      sort_order: 0,
      storage_path: 'brands/acme/product.webp',
    }
    let selectCount = 0
    const from = vi.fn((table: string) => {
      if (table === 'brand_ai_results') throw new Error('direct AI result insert is not allowed')
      return {
        select: () => {
          const rows = selectCount++ === 0 ? [image] : [{ ...image, tags: ['product'], score: 88 }]
          const query = {
            eq: () => query,
            neq: () => query,
            is: () => query,
            order: async () => ({ data: rows, error: null }),
          }
          return query
        },
        update: () => {
          const query = {
            eq: () => query,
            neq: () => query,
            not: () => query,
            select: async () => ({ data: [], error: null }),
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
          }
          return query
        },
      }
    })
    mocks.createServiceClient.mockReturnValue({ from })
    const chat = vi.fn().mockResolvedValue({
      content: '{"classifications":[{"tag":"product","score":88,"alt_zh":"木製餐盤","alt_en":"Wooden plate"}]}',
    })
    vi.mocked(createAuditedOpenAIClient).mockReturnValue({ chat } as never)

    await runClassifyImagesPhase({
      brand: { id: 'brand-1', slug: 'acme', name: 'Acme' },
      phases: ['classify_images'],
      target: { type: 'brand', id: 'brand-1' },
      jobId: 'job-1',
    })

    expect(createAuditedOpenAIClient).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'classify_images',
        jobId: 'job-1',
        target: { type: 'brand', id: 'brand-1' },
      }),
    )
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ imageIds: ['image-1'] }),
      }),
    )
    expect(from).not.toHaveBeenCalledWith('brand_ai_results')
  })
})
