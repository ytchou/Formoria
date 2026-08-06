import { beforeEach, describe, expect, it, vi } from 'vitest'
import { siteIdentityKey } from '../../site-identity-arbiter'
import { resolveQuarantine, runSiteIdentityPhase, type SiteIdentityQuarantine } from '../site-identity'
import { buildPhaseResult } from '../types'
import type { LinksPhaseOutput } from '../links'
import { CLEARED_FIELDS_KEY, resolveRefreshEnrichmentPatch } from '../../brand-write-policy'

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
  scrapedImageUrls: ['https://other.example/a.jpg', 'https://clean.example/clean.jpg', 'https://unprovenanced.example/unknown.jpg'],
  scrapedImageSources: [
    { url: 'https://other.example/a.jpg', method: 'crawl', pageUrl: 'https://other.example', position: 0 },
  ],
  jsonLdImageUrls: ['https://other.example/b.jpg'],
  quarantine: {},
})
const ctx = (phases: string[] = ['site_identity']) => ({
  chunk: [brand], chunkBrandNames: ['Han 茶'], phases: phases as never[], dryRun: false,
  supabase: {} as never, targetType: 'brand' as const, jobId: 'job-1',
})

describe('site identity quarantine', () => {
  beforeEach(() => arbitrate.mockReset())

  it('revokes only on high-confidence not-owned', () => {
    expect(resolveQuarantine({ slug: 'x', owned: false, confidence: 'high', reason: 'no' })).toEqual({ revoked: true, reason: 'no' })
  })

  it('undefined verdict releases', () => {
    expect(resolveQuarantine(undefined).revoked).toBe(false)
  })

  it('no-evidence subjects are never sent', async () => {
    const input = group({ evidence: {} }); const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(arbitrate).not.toHaveBeenCalled()
    expect(result.phaseResult.status).toBe('skipped')
  })

  it('counts quarantines dropped for empty evidence by subject kind', async () => {
    const evidence = group({ subjectUrl: 'https://evidence.example' })
    const website = group({ subjectUrl: 'https://website.example', subjectKind: 'website', evidence: {} })
    const sourcePage = group({ subjectUrl: 'https://source-page.example', evidence: {} })
    const summary: Record<string, unknown> = {}
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })

    await runSiteIdentityPhase({ ...ctx(), summary }, new Map([['brand-1', [evidence, website, sourcePage]]]))

    expect(summary.siteIdentityNoEvidence).toEqual({ website: 1, 'source-page': 1 })
  })

  it('counter is zero when every subject has evidence', async () => {
    const summary: Record<string, unknown> = {}
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })

    await runSiteIdentityPhase({ ...ctx(), summary }, new Map([['brand-1', [group()]]]))

    expect(summary).toHaveProperty('siteIdentityNoEvidence', { website: 0, 'source-page': 0 })
  })

  it('dropping for no evidence still releases the value', async () => {
    const input = group({ evidence: {} })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.patch.purchase_website).toBe('https://other.example')
    expect(result.applications).toEqual(new Map())
  })

  it("revoking this run's own value deletes the patch key", async () => {
    const input = group(); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch).not.toHaveProperty('purchase_website')
  })

  it('revoking a stored value adds it to _cleared_fields', async () => {
    const input = group({ patch: {}, columns: ['purchase_website'] }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const stored = { ...brand, purchase_website: 'https://other.example' }
    const result = await runSiteIdentityPhase({ ...ctx(), chunk: [stored] }, new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch._cleared_fields).toEqual(['purchase_website'])
  })

  it('brand-write-policy protects owner-sourced clears', () => {
    const result = resolveRefreshEnrichmentPatch({ [CLEARED_FIELDS_KEY]: ['purchase_website'] }, { purchase_website: { source: 'owner' } })
    expect(result.allowed).not.toHaveProperty('purchase_website')
    expect(result.skipped).toContainEqual({ field: 'purchase_website', reason: 'cleared:protected:owner' })
  })

  it('_cleared_fields unions with an existing entry', async () => {
    const input = group({ patch: { _cleared_fields: ['social_instagram'] } }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase({ ...ctx(), chunk: [{ ...brand, purchase_website: 'https://other.example' }] }, new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch._cleared_fields).toEqual(['social_instagram', 'purchase_website'])
  })

  it('revoked host images are dropped', async () => {
    const input = group({ linksResult: linksOutput() }); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(input.linksResult?.scrapedImageUrls).toEqual(['https://clean.example/clean.jpg', 'https://unprovenanced.example/unknown.jpg'])
    expect(input.linksResult?.jsonLdImageUrls).toEqual([])
  })

  it('source-page image filtering keeps other pages on the same host', async () => {
    const input = group({
      subjectUrl: 'https://www.facebook.com/NaHoku',
      linksResult: {
        ...linksOutput(),
        scrapedImageUrls: ['https://www.facebook.com/NaHoku/a.jpg', 'https://www.facebook.com/highjewellerydream/a.jpg'],
        scrapedImageSources: [
          { url: 'https://www.facebook.com/NaHoku/a.jpg', method: 'crawl', pageUrl: 'https://www.facebook.com/NaHoku', position: 0 },
          { url: 'https://www.facebook.com/highjewellerydream/a.jpg', method: 'crawl', pageUrl: 'https://www.facebook.com/highjewellerydream', position: 1 },
        ],
      },
    })
    arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(input.linksResult?.scrapedImageUrls).toEqual(['https://www.facebook.com/highjewellerydream/a.jpg'])
  })

  it('provider failure reports skipped and releases all', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 1 } })
    const input = group(); const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.phaseResult.status).toBe('skipped')
    expect(input.patch.purchase_website).toBe('https://other.example')
  })

  it('succeeded only on a real parsed verdict', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })
    const input = group(); expect((await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))).phaseResult.status).toBe('skipped')
  })

  it('phase not selected releases', async () => {
    const result = await runSiteIdentityPhase(ctx(['links']), new Map())
    expect(result.phaseResult.status).toBe('skipped')
  })

  // All quarantine groups of one brand share ONE live patch object. Merging the
  // per-group results by spreading snapshots of it re-added a key an earlier
  // group had deleted, persisting the contaminated value despite a
  // high-confidence not-owned verdict.
  it('a second group revocation does not resurrect the first group deleted column', async () => {
    const patch = { social_facebook: 'https://www.facebook.com/impostor', purchase_website: 'https://other.example' }
    const facebook = group({ subjectUrl: 'https://www.facebook.com/impostor', columns: ['social_facebook'], patch })
    const website = group({ subjectUrl: 'https://other.example', columns: ['purchase_website'], patch })
    const revoked = (subjectUrl: string) => [siteIdentityKey(brand.slug, subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }] as const
    arbitrate.mockResolvedValue({
      results: new Map([revoked(facebook.subjectUrl), revoked(website.subjectUrl)]),
      calls: { attempted: 1, providerFailed: 0 },
    })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [facebook, website]]]))
    expect(patch).not.toHaveProperty('social_facebook')
    expect(patch).not.toHaveProperty('purchase_website')
    const application = result.applications.get('brand-1')
    expect(application?.patch).not.toHaveProperty('purchase_website')
    expect(application?.removedColumns).toEqual(['social_facebook', 'purchase_website'])
  })

  it('a brand whose every group released keeps the release cause', async () => {
    const first = group({ subjectUrl: 'https://one.example' })
    const second = group({ subjectUrl: 'https://two.example', columns: ['social_facebook'] })
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [first, second]]]))
    const application = result.applications.get('brand-1')
    expect(application?.phaseResult.status).toBe('skipped')
    expect(application?.phaseResult.detail).toBe('provider-failure')
  })

  it('a medium-confidence verdict releases and records the confidence as the cause', async () => {
    const input = group()
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'medium', reason: 'unsure' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.phaseResult.detail).toBe('medium')
    expect(input.patch.purchase_website).toBe('https://other.example')
  })

  // `buildLinkEnrichPatch` writes an explicit null when the stored value is a
  // corporate account and no clean replacement was scraped. Deleting that key
  // would remove the pending CLEAR and leave the stored value untouched.
  it('an explicit null in the patch is a pending clear, not a proposed value', async () => {
    const input = group({ patch: { purchase_website: null } })
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })
    const result = await runSiteIdentityPhase({ ...ctx(), chunk: [{ ...brand, purchase_website: 'https://other.example' }] }, new Map([['brand-1', [input]]]))
    expect(input.patch.purchase_website).toBeNull()
    expect(result.applications.get('brand-1')?.patch._cleared_fields).toEqual(['purchase_website'])
  })

  it('a provider outage is attributed separately from a content failure', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 3, providerFailed: 3 } })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [group()]]]))
    expect(result.phaseResult.detail).toBe('provider failure (3/3 calls)')
    expect(result.phaseResult.providerFailure).toBeFalsy()
  })

  it('re-keys wire slug to target id', async () => {
    const input = group(); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.applications.has('brand-1')).toBe(true)
  })
})
