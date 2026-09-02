import { describe, expect, it, vi } from 'vitest'
import {
  verifySameHost,
  verifyReachable,
  verifyImage,
  verifyOrigin,
  verifyClosedSets,
  verifyProposal,
} from '../verify'

describe('products/verify', () => {
  describe('verifySameHost', () => {
    it('verifySameHost_passes_matching_hosts', () => {
      const result = verifySameHost(
        'https://www.example.com/product/1',
        'https://www.example.com',
      )
      expect(result.ok).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('verifySameHost_fails_different_hosts', () => {
      const result = verifySameHost(
        'https://shop.example.com/product/1',
        'https://www.other.com',
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('verifySameHost_fails_on_invalid_url', () => {
      const result = verifySameHost('not-a-url', 'https://example.com')
      expect(result.ok).toBe(false)
    })
  })

  describe('verifyReachable', () => {
    it('verifyReachable_passes_on_2xx', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      const result = await verifyReachable('https://example.com/product', mockFetch as typeof fetch)
      expect(result.ok).toBe(true)
    })

    it('verifyReachable_fails_on_non_2xx', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const result = await verifyReachable('https://example.com/gone', mockFetch as typeof fetch)
      expect(result.ok).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('verifyReachable_fails_on_network_error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS failure'))
      const result = await verifyReachable('https://example.com', mockFetch as typeof fetch)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('DNS failure')
    })
  })

  describe('verifyImage', () => {
    it('verifyImage_passes_when_rank_finds_image', () => {
      const pool = [{ url: 'https://example.com/img.jpg' }]
      const rankFn = vi.fn().mockReturnValue({ url: 'https://example.com/img.jpg', score: 1 })
      const result = verifyImage(
        { url: 'https://example.com/product' },
        pool,
        rankFn,
      )
      expect(result.ok).toBe(true)
    })

    it('verifyImage_fails_on_empty_pool', () => {
      const rankFn = vi.fn().mockReturnValue(null)
      const result = verifyImage(
        { url: 'https://example.com/product' },
        [],
        rankFn,
      )
      expect(result.ok).toBe(false)
    })

    it('verifyImage_fails_when_rank_returns_null', () => {
      const pool = [{ url: 'https://example.com/img.jpg' }]
      const rankFn = vi.fn().mockReturnValue(null)
      const result = verifyImage(
        { url: 'https://example.com/product' },
        pool,
        rankFn,
      )
      expect(result.ok).toBe(false)
    })
  })

  describe('verifyClosedSets', () => {
    it('verifyClosedSets_passes_valid_category_material', () => {
      const result = verifyClosedSets({
        category: 'fashion',
        subcategory: 'tops-and-tshirts',
        material: ['textile'],
      })
      expect(result.ok).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('verifyClosedSets_fails_unknown_category', () => {
      const result = verifyClosedSets({
        category: 'nonexistent-category',
        subcategory: undefined,
        material: [],
      })
      expect(result.ok).toBe(false)
      expect(result.failures.some(f => f.includes('category'))).toBe(true)
    })

    it('verifyClosedSets_fails_subcategory_wrong_parent', () => {
      // tops-and-tshirts belongs to fashion, not beauty
      const result = verifyClosedSets({
        category: 'beauty',
        subcategory: 'tops-and-tshirts',
        material: [],
      })
      expect(result.ok).toBe(false)
      expect(result.failures.some(f => f.includes('subcategory'))).toBe(true)
    })

    it('verifyClosedSets_fails_unknown_material', () => {
      const result = verifyClosedSets({
        category: 'fashion',
        material: ['textile', 'unobtainium'],
      })
      expect(result.ok).toBe(false)
      expect(result.failures.some(f => f.includes('material'))).toBe(true)
    })

    it('verifyClosedSets_passes_with_no_optional_fields', () => {
      const result = verifyClosedSets({
        category: 'home',
      })
      expect(result.ok).toBe(true)
      expect(result.failures).toHaveLength(0)
    })
  })

  describe('verifyOrigin', () => {
    it('verifyOrigin_delegates_to_decideOriginQualification', () => {
      const result = verifyOrigin({
        deterministic: { madeInTaiwan: true, materialsFromTaiwan: true, excerptIds: ['e1'] },
        llm: { madeInTaiwan: true, materialsFromTaiwan: true, excerptIds: ['e1'] },
        registry: { matched: true, recordId: '1', reason: 'matched' },
      })
      expect(result.ok).toBe(true)
      expect(result.decision.qualified).toBe(true)
    })

    it('verifyOrigin_fails_when_not_qualified', () => {
      const result = verifyOrigin({
        deterministic: { madeInTaiwan: false, materialsFromTaiwan: false, excerptIds: [] },
        llm: { madeInTaiwan: false, materialsFromTaiwan: false, excerptIds: [] },
        registry: { matched: false, recordId: null, reason: 'no_exact_match' },
      })
      expect(result.ok).toBe(false)
      expect(result.decision.qualified).toBe(false)
    })
  })

  describe('verifyProposal', () => {
    it('verifyProposal_marks_repairable_when_only_closed_set_fails', () => {
      const rankFn = vi.fn().mockReturnValue({ url: 'https://example.com/img.jpg', score: 1 })

      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'nonexistent',
          subcategory: undefined,
          material: [],
          imageUrl: 'https://example.com/img.jpg',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn,
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(true)
      expect(result.failures.length).toBeGreaterThan(0)
    })

    it('verifyProposal_not_repairable_when_host_fails', () => {
      const rankFn = vi.fn().mockReturnValue({ url: 'https://example.com/img.jpg', score: 1 })

      const result = verifyProposal(
        {
          url: 'https://other.com/product',
          category: 'fashion',
          subcategory: undefined,
          material: [],
          imageUrl: 'https://example.com/img.jpg',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn,
          sameHostResult: { ok: false, reason: 'host mismatch' },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(false)
    })

    it('verifyProposal_passes_when_all_checks_pass', () => {
      const rankFn = vi.fn().mockReturnValue({ url: 'https://example.com/img.jpg', score: 1 })

      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          subcategory: 'tops-and-tshirts',
          material: ['textile'],
          imageUrl: 'https://example.com/img.jpg',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn,
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(true)
      expect(result.repairable).toBe(false)
      expect(result.failures).toHaveLength(0)
    })
  })
})
