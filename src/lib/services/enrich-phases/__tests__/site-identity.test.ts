import { beforeEach, describe, expect, it, vi } from 'vitest'
import { siteIdentityKey } from '../../site-identity-arbiter'
import { resolveQuarantine, runSiteIdentityPhase, type SiteIdentityQuarantine } from '../site-identity'
import { buildPhaseResult } from '../types'
import type { LinksPhaseOutput } from '../links'

const arbitrate = vi.hoisted(() => vi.fn())
vi.mock('../../site-identity-arbiter', async () => {
  const actual = await vi.importActual<typeof import('../../site-identity-arbiter')>('../../site-identity-arbiter')
  return { ...actual, arbitrateSiteIdentity: arbitrate }
})

const brand = { id: 'brand-1', slug: 'wire-slug', name: 'Han 茶', product_type: 'tea' }
const group = (overrides: Partial<SiteIdentityQuarantine> = {}): SiteIdentityQuarantine => ({
  subjectUrl: 'https://other.example',
  subjectKind: 'source-page',
  columns: ['purchase_website'],
  evidence: { description: 'Han tea' },
  patch: { purchase_website: 'https://other.example' },
  scrapedData: { textSourceUrl: 'https://other.example' },
  ...overrides,
})
const linksOutput = (): LinksPhaseOutput => ({
  phaseResult: buildPhaseResult('links', 'succeeded', [], 0),
  patch: {},
  scrapedBrandName: null,
  scrapedData: { websiteUrl: 'https://other.example' },
  scrapedImageUrls: ['https://other.example/a.jpg'],
  scrapedImageSources: [
    { url: 'https://other.example/a.jpg', method: 'crawl', pageUrl: 'https://other.example', position: 0 },
  ],
  jsonLdImageUrls: ['https://other.example/b.jpg'],
  quarantine: {},
})
const ctx = (groups: SiteIdentityQuarantine[], phases: string[] = ['site_identity']) => ({
  chunk: [brand], chunkBrandNames: ['Han 茶'], phases: phases as never[], dryRun: false,
  supabase: {} as never, targetType: 'brand' as const, jobId: 'job-1',
})

describe('site identity quarantine', () => {
  beforeEach(() => arbitrate.mockReset())

  it('revokes only on high-confidence not-owned', () => {
    expect(resolveQuarantine({ slug: 'x', owned: false, confidence: 'high', reason: 'no' }, group())).toEqual({ revoked: true, reason: 'no' })
  })

  it('undefined verdict releases', () => {
    expect(resolveQuarantine(undefined, group()).revoked).toBe(false)
  })

  it('no-evidence subjects are never sent', async () => {
    const result = await runSiteIdentityPhase(ctx([group({ evidence: {} })]), new Map([['brand-1', [group({ evidence: {} })]]]))
    expect(arbitrate).not.toHaveBeenCalled()
    expect(result.phaseResult.status).toBe('skipped')
  })

  it("revoking this run's own value deletes the patch key", async () => {
    const input = group(); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx([input]), new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch).not.toHaveProperty('purchase_website')
  })

  it('revoking a stored value adds it to _cleared_fields', async () => {
    const input = group({ patch: {}, columns: ['purchase_website'] }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const stored = { ...brand, purchase_website: 'https://other.example' }
    const result = await runSiteIdentityPhase({ ...ctx([input]), chunk: [stored] }, new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch._cleared_fields).toEqual(['purchase_website'])
  })

  it('an owner-sourced field is not cleared', async () => {
    const input = group({ patch: {}, fieldStates: { purchase_website: { source: 'owner' } } }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase({ ...ctx([input]), chunk: [{ ...brand, purchase_website: 'https://other.example' }] }, new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch).toEqual({})
  })

  it('_cleared_fields unions with an existing entry', async () => {
    const input = group({ patch: { _cleared_fields: ['social_instagram'] } }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase({ ...ctx([input]), chunk: [{ ...brand, purchase_website: 'https://other.example' }] }, new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch._cleared_fields).toEqual(['social_instagram', 'purchase_website'])
  })

  it('revoked host images are dropped', async () => {
    const input = group({ linksResult: linksOutput() }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    await runSiteIdentityPhase(ctx([input]), new Map([['brand-1', [input]]]))
    expect(input.linksResult?.scrapedImageUrls).toEqual([])
    expect(input.linksResult?.jsonLdImageUrls).toEqual([])
  })

  it('provider failure reports skipped and releases all', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 1 } })
    const input = group(); const result = await runSiteIdentityPhase(ctx([input]), new Map([['brand-1', [input]]]))
    expect(result.phaseResult.status).toBe('skipped')
    expect(input.patch.purchase_website).toBe('https://other.example')
  })

  it('succeeded only on a real parsed verdict', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })
    expect((await runSiteIdentityPhase(ctx([group()]), new Map([['brand-1', [group()]]]))).phaseResult.status).toBe('skipped')
  })

  it('phase not selected releases', async () => {
    const result = await runSiteIdentityPhase(ctx([group()], ['links']), new Map())
    expect(result.phaseResult.status).toBe('skipped')
  })

  it('re-keys wire slug to target id', async () => {
    const input = group(); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx([input]), new Map([['brand-1', [input]]]))
    expect(result.applications.has('brand-1')).toBe(true)
  })
})
