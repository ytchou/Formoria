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

  it('separates released and revoked no-evidence tallies', async () => {
    const website = group({ subjectUrl: 'https://website.example', subjectKind: 'website', evidence: {}, unverifiable: true })
    const sourcePage = group({ subjectUrl: 'https://source-page.example', evidence: {} })
    const summary: Record<string, unknown> = {}

    await runSiteIdentityPhase(
      { ...ctx(), summary },
      new Map([['brand-1', [website, sourcePage]]]),
    )

    expect(summary.siteIdentityNoEvidence).toEqual({ website: 1, 'source-page': 1 })
    expect(summary.siteIdentityRevokedNoEvidence).toEqual({ website: 1, 'source-page': 0 })
  })

  // The chunk this counter exists to measure is the one where NOTHING is
  // judgeable, which is also the chunk that takes the `no evidence` early
  // return. Publishing the tally only after that return drops it in exactly
  // that case, leaving the audit row indistinguishable from "nothing was
  // quarantined at all".
  it('a chunk where every group lacks evidence still reports its tallies', async () => {
    const website = group({ subjectUrl: 'https://website.example', subjectKind: 'website', evidence: {} })
    const secondWebsite = group({ subjectUrl: 'https://website-2.example', subjectKind: 'website', evidence: {} })
    const sourcePage = group({ subjectUrl: 'https://source-page.example', evidence: {} })
    const summary: Record<string, unknown> = {}

    const result = await runSiteIdentityPhase(
      { ...ctx(), summary },
      new Map([['brand-1', [website, secondWebsite, sourcePage]]]),
    )

    expect(arbitrate).not.toHaveBeenCalled()
    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.detail).toBe('no evidence')
    expect(summary.siteIdentityNoEvidence).toEqual({ website: 2, 'source-page': 1 })
  })

  // auditedCall rethrows, and the caller hands in the live outer-span summary
  // object, so a tally published before the arbiter call survives the throw.
  // Losing it would blind the production gate exactly when the arbiter fails.
  it('keeps the no-evidence tally when the arbiter throws', async () => {
    const evidence = group({ subjectUrl: 'https://evidence.example' })
    const website = group({ subjectUrl: 'https://website.example', subjectKind: 'website', evidence: {} })
    const summary: Record<string, unknown> = {}
    // `Once`, not a persistent rejection: a rejecting implementation left on the
    // shared mock is re-invoked after the test body and surfaces as a stray
    // failure on this test even though every assertion here passed.
    arbitrate.mockRejectedValueOnce(new Error('boom'))

    await expect(
      runSiteIdentityPhase({ ...ctx(), summary }, new Map([['brand-1', [evidence, website]]])),
    ).rejects.toThrow('boom')

    expect(summary.siteIdentityNoEvidence).toEqual({ website: 1, 'source-page': 0 })
  })

  it('counter is zero when every subject has evidence', async () => {
    const summary: Record<string, unknown> = {}
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 0 } })

    await runSiteIdentityPhase({ ...ctx(), summary }, new Map([['brand-1', [group()]]]))

    expect(summary).toHaveProperty('siteIdentityNoEvidence', { website: 0, 'source-page': 0 })
    expect(summary).toHaveProperty('siteIdentityRevokedNoEvidence', { website: 0, 'source-page': 0 })
  })

  it('dropping for no evidence still releases the value', async () => {
    const input = group({ evidence: {} })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.patch.purchase_website).toBe('https://other.example')
    expect(result.applications).toEqual(new Map())
  })

  it('revokes an unverifiable website with no evidence', async () => {
    const input = group({ subjectKind: 'website', evidence: {}, unverifiable: true })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.patch).not.toHaveProperty('purchase_website')
    const application = result.applications.get('brand-1')
    expect(application?.phaseResult.status).toBe('succeeded')
    expect(application?.phaseResult.detail).toBe('no-evidence')
    expect(application?.phaseResult.changedFields).toEqual(['purchase_website'])
    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.detail).toBeUndefined()
  })

  // DEV-1367 revokes text a verdict rejected. The no-evidence path has no
  // verdict, so it must not reach text — the same reason it does not drop
  // images. Nothing said the site was wrong; only that it could not be judged.
  it('keeps scraped text when an unverifiable website is revoked without evidence', async () => {
    const input = group({
      subjectUrl: 'https://other.example',
      subjectKind: 'website',
      evidence: {},
      unverifiable: true,
      scrapedData: {
        description: 'Brand copy',
        story: 'Brand story',
        textSourceUrl: 'https://other.example',
        textProvenance: { description: { sourceUrl: 'https://other.example' } },
      },
    })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBe('Brand copy')
    expect(input.scrapedData?.story).toBe('Brand story')
    expect(input.scrapedData?.textSourceUrl).toBe('https://other.example')
    expect(input.scrapedData?.textProvenance).toEqual({
      description: { sourceUrl: 'https://other.example' },
    })
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('publishes the revocation-only audit summary', async () => {
    const input = group({ subjectKind: 'website', evidence: {}, unverifiable: true })
    const summary: Record<string, unknown> = {}
    const key = siteIdentityKey(brand.slug, input.subjectUrl)

    await runSiteIdentityPhase(
      { ...ctx(), summary },
      new Map([['brand-1', [input]]]),
    )

    expect(summary.siteIdentity).toEqual({
      [key]: {
        verdict: undefined,
        confidence: undefined,
        reason: undefined,
        releaseCause: 'no-evidence',
        revokedColumns: ['purchase_website'],
      },
    })
    expect(summary.siteIdentityRung1Escalations).toBe(0)
    expect(summary.siteIdentityCalls).toEqual({ attempted: 0, providerFailed: 0 })
    expect(summary.siteIdentityProviderFailure).toBe(false)
  })

  it('scopes an unarbitrated website revoke to the website column', async () => {
    const input = group({
      subjectKind: 'website',
      columns: ['purchase_website', 'social_instagram'],
      patch: {
        purchase_website: 'https://other.example',
        social_instagram: 'https://www.instagram.com/real-brand',
      },
      evidence: {},
      unverifiable: true,
    })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(input.patch.social_instagram).toBe('https://www.instagram.com/real-brand')
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('keeps images when an unverifiable website is revoked without evidence', async () => {
    const linksResult = linksOutput()
    const originalImageUrls = [...linksResult.scrapedImageUrls]
    const originalImageSources = [...linksResult.scrapedImageSources]
    const originalJsonLdImageUrls = [...linksResult.jsonLdImageUrls]
    const input = group({ subjectKind: 'website', evidence: {}, unverifiable: true, linksResult })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.linksResult?.scrapedImageUrls).toEqual(originalImageUrls)
    expect(input.linksResult?.scrapedImageSources).toEqual(originalImageSources)
    expect(input.linksResult?.jsonLdImageUrls).toEqual(originalJsonLdImageUrls)
    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('releases an unverifiable social with no evidence', async () => {
    const input = group({ evidence: {}, unverifiable: true })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.patch.purchase_website).toBe('https://other.example')
    expect(result.applications).toEqual(new Map())
  })

  it('revoking a non-null proposal leaves the stored value intact', async () => {
    const input = group({ patch: { purchase_website: 'https://proposed.example' } })
    const stored = { ...brand, purchase_website: 'https://stored.example' }
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })

    const result = await runSiteIdentityPhase({ ...ctx(), chunk: [stored] }, new Map([['brand-1', [input]]]))

    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(input.patch).not.toHaveProperty(CLEARED_FIELDS_KEY)
    expect(result.applications.get('brand-1')?.clearedFields).toEqual([])
  })

  it("revoking this run's own value deletes the patch key", async () => {
    const input = group(); arbitrate.mockResolvedValue({ results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]), calls: { attempted: 1, providerFailed: 0 } })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.patch).not.toHaveProperty('purchase_website')
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toEqual(['purchase_website'])
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

  // DEV-1367. For a Han-only brand name the link-identity gate is a no-op
  // (`handleMatchesBrand` returns true on zero tokens), so a stranger's
  // Instagram can be scraped and — when the official site yielded no text —
  // its bio becomes the merged `description`/`story`. Before this, `revokeFields`
  // cleared link columns and `filterRevokedImages` cleared images, but NOTHING
  // cleared text: a high-confidence not-owned verdict still left another party's
  // copy in `state.scrapedData` for the reputation and faq phases to consume.
  const textGroup = (overrides: Partial<SiteIdentityQuarantine> = {}): SiteIdentityQuarantine =>
    group({
      subjectUrl: 'https://www.instagram.com/stranger',
      columns: ['social_instagram'],
      patch: { social_instagram: 'https://www.instagram.com/stranger' },
      scrapedData: {
        description: "A stranger's bio",
        story: "A stranger's story",
        textProvenance: {
          description: { sourceUrl: 'https://www.instagram.com/stranger' },
          story: { sourceUrl: 'https://www.instagram.com/stranger' },
        },
        textSourceUrl: 'https://www.instagram.com/stranger',
      },
      ...overrides,
    })
  const revokes = (subjectUrl: string) =>
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, subjectUrl), { slug: brand.slug, owned: false, confidence: 'high', reason: 'wrong' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })

  it('revokes text sourced from the revoked page', async () => {
    const input = textGroup()
    revokes(input.subjectUrl)

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBeNull()
    expect(input.scrapedData?.story).toBeNull()
    expect(input.scrapedData?.textProvenance).toBeUndefined()
    expect(input.scrapedData?.textSourceUrl).toBeUndefined()
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toContain('description')
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toContain('story')
  })

  // The stored column is deliberately untouched: `textProvenance` describes THIS
  // run only, and nothing records the source of a description written by an
  // earlier one. Clearing it would destroy legitimate copy on a host that later
  // serves one bad page.
  it('does not add text fields to _cleared_fields', async () => {
    const input = textGroup()
    revokes(input.subjectUrl)

    const result = await runSiteIdentityPhase(
      { ...ctx(), chunk: [{ ...brand, description: 'Stored copy' }] },
      new Map([['brand-1', [input]]]),
    )

    expect(result.applications.get('brand-1')?.patch._cleared_fields ?? []).not.toContain('description')
  })

  // Same rule the image filter follows: text whose source page is unknown is
  // released, not struck. Releasing is the safe direction.
  it('leaves text with no provenance alone', async () => {
    const input = textGroup({
      scrapedData: { description: 'Unprovenanced copy', story: null },
    })
    revokes(input.subjectUrl)

    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBe('Unprovenanced copy')
  })

  it('leaves text sourced from a different page alone', async () => {
    const input = textGroup({
      scrapedData: {
        description: 'Official copy',
        story: null,
        textProvenance: { description: { sourceUrl: 'https://official.example' } },
        textSourceUrl: 'https://official.example',
      },
    })
    revokes(input.subjectUrl)

    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBe('Official copy')
    expect(input.scrapedData?.textSourceUrl).toBe('https://official.example')
  })

  // A source-page subject owns its own subtree, not the whole host — the same
  // asymmetry `filterRevokedImages` already applies to images.
  it('a source-page verdict does not revoke text from a sibling page on the same host', async () => {
    const input = textGroup({
      subjectUrl: 'https://www.facebook.com/impostor',
      scrapedData: {
        description: 'Real brand page copy',
        story: null,
        textProvenance: { description: { sourceUrl: 'https://www.facebook.com/realbrand' } },
      },
    })
    revokes(input.subjectUrl)

    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBe('Real brand page copy')
  })

  // A website subject owns the whole domain, so every page under it goes.
  it('a website verdict revokes text from any page on that host', async () => {
    const input = textGroup({
      subjectUrl: 'https://impostor.example',
      subjectKind: 'website',
      columns: ['purchase_website'],
      patch: { purchase_website: 'https://impostor.example' },
      scrapedData: {
        description: 'Deep page copy',
        story: null,
        textProvenance: { description: { sourceUrl: 'https://impostor.example/about' } },
      },
    })
    revokes(input.subjectUrl)

    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBeNull()
  })

  it('a released verdict leaves text intact', async () => {
    const input = textGroup()
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'medium', reason: 'unsure' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })

    await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))

    expect(input.scrapedData?.description).toBe("A stranger's bio")
  })

  it('provider failure reports skipped and releases all', async () => {
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 1 } })
    const input = group(); const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.phaseResult.status).toBe('skipped')
    expect(input.patch.purchase_website).toBe('https://other.example')
  })

  it('keeps provider failure detail when another brand is revoked without evidence', async () => {
    const secondBrand = { id: 'brand-2', slug: 'second-slug', name: 'Second Tea', product_type: 'tea' }
    const noEvidence = group({ subjectKind: 'website', evidence: {}, unverifiable: true })
    const evidence = group({ subjectUrl: 'https://evidence.example' })
    const summary: Record<string, unknown> = {}
    arbitrate.mockResolvedValue({ results: new Map(), calls: { attempted: 1, providerFailed: 1 } })

    const result = await runSiteIdentityPhase(
      {
        ...ctx(),
        chunk: [brand, secondBrand],
        chunkBrandNames: ['Han 茶', 'Second Tea'],
        summary,
      },
      new Map([
        ['brand-1', [noEvidence]],
        ['brand-2', [evidence]],
      ]),
    )

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.detail).toBe('provider failure (1/1 calls)')
    expect(summary.siteIdentityProviderFailure).toBe(true)
    expect(result.applications.get('brand-1')?.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('merges an evidence verdict with a no-evidence revocation', async () => {
    const evidence = group({ subjectUrl: 'https://evidence.example' })
    const noEvidence = group({ subjectUrl: 'https://website.example', subjectKind: 'website', evidence: {}, unverifiable: true })
    arbitrate.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 0 },
    })

    const result = await runSiteIdentityPhase(
      ctx(),
      new Map([['brand-1', [evidence, noEvidence]]]),
    )

    expect(result.applications.get('brand-1')?.phaseResult.status).toBe('succeeded')
    expect(result.applications.get('brand-1')?.phaseResult.detail).toBe('no-evidence; provider-failure')
    expect(result.phaseResult.status).toBe('succeeded')
  })

  it('counts total and revoked no-evidence subjects separately', async () => {
    const revokedOne = group({ subjectUrl: 'https://revoked-one.example', subjectKind: 'website', evidence: {}, unverifiable: true })
    const revokedTwo = group({ subjectUrl: 'https://revoked-two.example', subjectKind: 'website', evidence: {}, unverifiable: true })
    const releasedWebsite = group({ subjectUrl: 'https://released.example', subjectKind: 'website', evidence: {} })
    const releasedSource = group({ subjectUrl: 'https://source.example', subjectKind: 'source-page', evidence: {} })
    const summary: Record<string, unknown> = {}

    await runSiteIdentityPhase(
      { ...ctx(), summary },
      new Map([['brand-1', [revokedOne, revokedTwo, releasedWebsite, releasedSource]]]),
    )

    expect(summary.siteIdentityNoEvidence).toEqual({ website: 3, 'source-page': 1 })
    expect(summary.siteIdentityRevokedNoEvidence).toEqual({ website: 2, 'source-page': 0 })
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

  it('marks a judged-and-released brand as succeeded', async () => {
    const input = group()
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: true, confidence: 'high', reason: 'owned' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    const application = result.applications.get('brand-1')

    expect(application?.phaseResult.status).toBe('succeeded')
    expect(application?.phaseResult.changedFields).toEqual([])
    expect(application?.phaseResult.detail).toBe('owned')
  })

  it('preserves complete reasons when one reason contains a semicolon', async () => {
    const first = group({ subjectUrl: 'https://first.example' })
    const second = group({ subjectUrl: 'https://second.example', columns: ['social_facebook'], patch: { social_facebook: 'https://www.facebook.com/second' } })
    const verdict = (subjectUrl: string, reason: string) => [
      siteIdentityKey(brand.slug, subjectUrl),
      { slug: brand.slug, owned: false, confidence: 'high', reason },
    ] as const
    arbitrate.mockResolvedValue({
      results: new Map([
        verdict(first.subjectUrl, 'first; second'),
        verdict(second.subjectUrl, 'second'),
      ]),
      calls: { attempted: 1, providerFailed: 0 },
    })

    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [first, second]]]))

    expect(result.applications.get('brand-1')?.phaseResult.detail).toBe('first; second; second')
  })

  it('a medium-confidence verdict releases and records the confidence as the cause', async () => {
    const input = group()
    arbitrate.mockResolvedValue({
      results: new Map([[siteIdentityKey(brand.slug, input.subjectUrl), { slug: brand.slug, owned: false, confidence: 'medium', reason: 'unsure' }]]),
      calls: { attempted: 1, providerFailed: 0 },
    })
    const result = await runSiteIdentityPhase(ctx(), new Map([['brand-1', [input]]]))
    expect(result.applications.get('brand-1')?.phaseResult.detail).toBe('medium')
    expect(result.applications.get('brand-1')?.phaseResult.status).toBe('succeeded')
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
