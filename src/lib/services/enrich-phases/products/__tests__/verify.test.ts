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

    // DEV-1715: a store on a marketplace the brand lists as its own channel
    // (purchase_pinkoi, purchase_myship) is the brand's channel too. The set
    // is the one the products phase already gates candidates with, so a
    // proposal can only reach here on a host site-identity arbitrated.
    it('verifySameHost_passes_host_in_owned_channels', () => {
      const result = verifySameHost(
        'https://www.pinkoi.com/product/abc123',
        'https://vividia.com.tw',
        ['pinkoi.com'],
      )
      expect(result.ok).toBe(true)
    })

    it('verifySameHost_fails_host_outside_owned_channels', () => {
      const result = verifySameHost(
        'https://shopee.tw/product/abc123',
        'https://vividia.com.tw',
        ['pinkoi.com'],
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('host mismatch')
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
          nameZh: 'Test Product',
          productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。',
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
          nameZh: 'Test Product',
          productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。',
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
          nameZh: 'Test Product',
          productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。',
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
      expect(result.imageStatus).toBe('verified')
    })

    it('products_verify_calls_verifyOrigin', () => {
      const rankFn = vi.fn().mockReturnValue({ url: 'https://example.com/img.jpg', score: 1 })

      const qualified = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          material: [],
          nameZh: 'Test Product',
          productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn,
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
          origin: {
            deterministic: { madeInTaiwan: true, materialsFromTaiwan: true, excerptIds: ['e1'] },
            llm: { madeInTaiwan: true, materialsFromTaiwan: true, excerptIds: ['e1'] },
            registry: { matched: false, recordId: null, reason: 'no_exact_match' },
          },
        },
      )

      expect(qualified.origin).toEqual({ qualified: true, method: 'consensus' })
      // Origin is enrichment, not a gate: a qualified product is not "more ok".
      expect(qualified.ok).toBe(true)

      const unqualified = verifyProposal(
        { url: 'https://example.com/product', category: 'fashion', material: [], nameZh: 'Test Product', productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。' },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn,
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
          origin: {
            deterministic: { madeInTaiwan: false, materialsFromTaiwan: false, excerptIds: [] },
            llm: { madeInTaiwan: false, materialsFromTaiwan: false, excerptIds: [] },
            registry: { matched: false, recordId: null, reason: 'no_exact_match' },
          },
        },
      )

      expect(unqualified.origin?.qualified).toBe(false)
      // NOT made in Taiwan is still a listable product.
      expect(unqualified.ok).toBe(true)
      expect(unqualified.failures).toHaveLength(0)
    })

    it('verifyProposal_reports_origin_null_when_no_evidence_was_supplied', () => {
      const result = verifyProposal(
        { url: 'https://example.com/product', category: 'fashion', material: [], nameZh: 'Test Product', productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。' },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )

      // "Not assessed" and "assessed as not Taiwanese" are different answers.
      expect(result.origin).toBeNull()
    })

    it('verify_records_unverified_image_when_pool_empty', () => {
      const rankFn = vi.fn()

      const result = verifyProposal(
        { url: 'https://example.com/product', category: 'fashion', material: [], nameZh: 'Test Product', productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。' },
        {
          brandUrl: 'https://example.com',
          imagePool: [],
          rankFn,
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )

      // Nothing to rank, so nothing is ranked — but the pass is not silent.
      expect(rankFn).not.toHaveBeenCalled()
      expect(result.imageStatus).toBe('unverified')
      expect(result.warnings.some((w) => w.startsWith('image_unverified'))).toBe(true)
      expect(result.ok).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('verifyProposal_records_unverified_when_pool_has_no_match', () => {
      const result = verifyProposal(
        { url: 'https://example.com/product', category: 'fashion', material: [], nameZh: 'Test Product', productDescriptionZh: '這是一個測試產品描述，用來驗證提案流程。' },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/other.jpg' }],
          rankFn: vi.fn().mockReturnValue(null),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )

      // No match is a warning, not a failure — the proposal proceeds unverified.
      expect(result.imageStatus).toBe('unverified')
      expect(result.ok).toBe(true)
      expect(result.failures).toHaveLength(0)
      expect(result.warnings.some((w) => w.startsWith('image_unverified'))).toBe(true)
    })

    it('verifyProposal flags description_name_echo as repairable', () => {
      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          material: [],
          nameZh: '手工皮革包',
          productDescriptionZh: '手工皮革包採用義大利植鞣牛皮製作',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(true)
      expect(result.failures.some(f => f.startsWith('description_name_echo:'))).toBe(true)
    })

    it('verifyProposal flags description_forbidden_term with the term as detail', () => {
      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          material: [],
          nameZh: '皮革托特包',
          productDescriptionZh: '值得收藏的義大利植鞣牛皮托特包',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(true)
      expect(result.failures.some(f => f.includes('description_forbidden_term:值得'))).toBe(true)
    })

    it('verifyProposal flags description_forbidden_term for pricing overlap terms instead of description_pricing', () => {
      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          material: [],
          nameZh: '皮革托特包',
          productDescriptionZh: '義大利植鞣牛皮，售價 NT$1,200',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(true)
      // 售價 is caught by forbidden terms; description_pricing is suppressed to avoid double-counting
      expect(result.failures.some(f => f.includes('description_forbidden_term:售價'))).toBe(true)
      expect(result.failures.some(f => f.startsWith('description_pricing:'))).toBe(false)
    })

    it('verifyProposal flags description_pricing when pricing pattern has no forbidden term overlap', () => {
      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          material: [],
          nameZh: '皮革托特包',
          productDescriptionZh: '義大利植鞣牛皮，NT$1,200 含運',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(true)
      expect(result.failures.some(f => f.startsWith('description_pricing:'))).toBe(true)
    })

    it('verifyProposal passes a factual description that does not echo the name', () => {
      const result = verifyProposal(
        {
          url: 'https://example.com/product',
          category: 'fashion',
          subcategory: 'tops-and-tshirts',
          material: ['textile'],
          nameZh: '手工皮革包',
          productDescriptionZh: '義大利植鞣牛皮手染鞋面與鞋墊',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: true },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(true)
      expect(result.failures.filter(f => f.startsWith('description_'))).toHaveLength(0)
    })

    it('description failures never set repairable when a URL check failed', () => {
      const result = verifyProposal(
        {
          url: 'https://other.com/product',
          category: 'fashion',
          material: [],
          nameZh: '手工皮革包',
          productDescriptionZh: '手工皮革包採用義大利植鞣牛皮製作',
        },
        {
          brandUrl: 'https://example.com',
          imagePool: [{ url: 'https://example.com/img.jpg' }],
          rankFn: vi.fn().mockReturnValue({ score: 1 }),
          sameHostResult: { ok: false, reason: 'host mismatch' },
          reachableResult: { ok: true },
        },
      )
      expect(result.ok).toBe(false)
      expect(result.repairable).toBe(false)
    })
  })
})
