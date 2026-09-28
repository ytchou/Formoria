import { describe, expect, it } from 'vitest'
import {
  applyRevocation,
  resolveQuarantine,
  siteIdentityKey,
  verdictsFromCritique,
  type SiteIdentityQuarantine,
} from '../site-identity'
import { buildPhaseResult } from '../types'
import type { AcquirePhaseOutput } from '../acquire'
import { CLEARED_FIELDS_KEY, resolveRefreshEnrichmentPatch } from '../../brand-write-policy'

const brand = { id: 'brand-1', slug: 'wire-slug', name: 'Han 茶', category: 'tea' }
const group = (overrides: Partial<SiteIdentityQuarantine> = {}): SiteIdentityQuarantine => ({
  subjectUrl: 'https://other.example',
  subjectKind: 'source-page',
  columns: ['purchase_website'],
  evidence: { description: 'Han tea' },
  patch: { purchase_website: 'https://other.example' },
  scrapedData: { textSourceUrl: 'https://other.example' },
  ...overrides,
})
const linksOutput = (): AcquirePhaseOutput => ({
  phaseResult: buildPhaseResult('links', 'succeeded', [], 0),
  patch: {},
  scrapedBrandName: null,
  officialNameCandidates: [],
  scrapedData: { websiteUrl: 'https://other.example' },
  scrapedImageUrls: ['https://other.example/a.jpg', 'https://clean.example/clean.jpg', 'https://unprovenanced.example/unknown.jpg'],
  scrapedImageSources: [
    { url: 'https://other.example/a.jpg', method: 'crawl', pageUrl: 'https://other.example', position: 0 },
  ],
  jsonLdImageUrls: ['https://other.example/b.jpg'],
  quarantine: {},
  imagePool: [],
  acquisitionPageUrls: [],
  priorityProductUrls: [],
  revokedColumns: [],
  providerFailure: false,
})

describe('resolveQuarantine', () => {
  it('revokes only on high-confidence not-owned', () => {
    expect(resolveQuarantine({ slug: 'x', owned: false, confidence: 'high', reason: 'no' })).toEqual({ revoked: true, reason: 'no' })
  })

  it('undefined verdict releases', () => {
    expect(resolveQuarantine(undefined)).toEqual({ revoked: false, reason: 'provider-failure' })
  })

  it('a high-confidence owned verdict releases with cause "owned"', () => {
    expect(resolveQuarantine({ slug: 'x', owned: true, confidence: 'high', reason: 'official' })).toEqual({ revoked: false, reason: 'owned' })
  })

  it('a medium-confidence verdict releases and records the confidence as the cause', () => {
    expect(resolveQuarantine({ slug: 'x', owned: false, confidence: 'medium', reason: 'unsure' })).toEqual({ revoked: false, reason: 'medium' })
  })
})

describe('applyRevocation', () => {
  it('revoking a non-null proposal leaves the stored value intact', () => {
    const input = group({ patch: { purchase_website: 'https://proposed.example' } })
    const stored = { ...brand, purchase_website: 'https://stored.example' }

    const application = applyRevocation(stored, input, 'wrong')

    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(input.patch).not.toHaveProperty(CLEARED_FIELDS_KEY)
    expect(application.clearedFields).toEqual([])
  })

  it("revoking this run's own value deletes the patch key", () => {
    const application = applyRevocation(brand, group(), 'wrong')
    expect(application.patch).not.toHaveProperty('purchase_website')
    expect(application.phaseResult.changedFields).toEqual(['purchase_website'])
    expect(application.removedColumns).toEqual(['purchase_website'])
  })

  it('revoking a stored value adds it to _cleared_fields', () => {
    const input = group({ patch: {}, columns: ['purchase_website'] })
    const stored = { ...brand, purchase_website: 'https://other.example' }
    const application = applyRevocation(stored, input, 'wrong')
    expect(application.patch._cleared_fields).toEqual(['purchase_website'])
    expect(input.patch._cleared_fields).toEqual(['purchase_website'])
  })

  it('brand-write-policy protects owner-sourced clears', () => {
    const result = resolveRefreshEnrichmentPatch({ [CLEARED_FIELDS_KEY]: ['purchase_website'] }, { purchase_website: { source: 'owner' } })
    expect(result.allowed).not.toHaveProperty('purchase_website')
    expect(result.skipped).toContainEqual({ field: 'purchase_website', reason: 'cleared:protected:owner' })
  })

  it('_cleared_fields unions with an existing entry', () => {
    const input = group({ patch: { _cleared_fields: ['social_instagram'] } })
    const application = applyRevocation({ ...brand, purchase_website: 'https://other.example' }, input, 'wrong')
    expect(application.patch._cleared_fields).toEqual(['social_instagram', 'purchase_website'])
  })

  // `buildLinkEnrichPatch` writes an explicit null when the stored value is a
  // corporate account and no clean replacement was scraped. Deleting that key
  // would remove the pending CLEAR and leave the stored value untouched.
  it('an explicit null in the patch is a pending clear, not a proposed value', () => {
    const input = group({ patch: { purchase_website: null } })
    const application = applyRevocation({ ...brand, purchase_website: 'https://other.example' }, input, 'wrong')
    expect(input.patch.purchase_website).toBeNull()
    expect(application.patch._cleared_fields).toEqual(['purchase_website'])
  })

  // All quarantine groups of one brand share ONE live patch object (acquire
  // passes the same `patch` into every group's revocation). A later group must
  // never re-add a key an earlier group deleted.
  it('a second group revocation does not resurrect the first group deleted column', () => {
    const patch = { social_facebook: 'https://www.facebook.com/impostor', purchase_website: 'https://other.example' }
    const facebook = group({ subjectUrl: 'https://www.facebook.com/impostor', columns: ['social_facebook'], patch })
    const website = group({ subjectUrl: 'https://other.example', columns: ['purchase_website'], patch })

    const first = applyRevocation(brand, facebook, 'wrong')
    const second = applyRevocation(brand, website, 'wrong')

    expect(patch).not.toHaveProperty('social_facebook')
    expect(patch).not.toHaveProperty('purchase_website')
    expect(second.patch).not.toHaveProperty('social_facebook')
    expect(second.patch).not.toHaveProperty('purchase_website')
    expect([...first.removedColumns, ...second.removedColumns]).toEqual(['social_facebook', 'purchase_website'])
  })

  it('revoked host images are dropped', () => {
    const input = group({ linksResult: linksOutput() })
    applyRevocation(brand, input, 'wrong')
    expect(input.linksResult?.scrapedImageUrls).toEqual(['https://clean.example/clean.jpg', 'https://unprovenanced.example/unknown.jpg'])
    expect(input.linksResult?.jsonLdImageUrls).toEqual([])
  })

  it('source-page image filtering keeps other pages on the same host', () => {
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
    applyRevocation(brand, input, 'wrong')
    expect(input.linksResult?.scrapedImageUrls).toEqual(['https://www.facebook.com/highjewellerydream/a.jpg'])
  })

  // `revokeHostContent: false` is the opt-out for a revocation with no verdict
  // behind it: nothing said the host was wrong, so its text and images stay.
  it('revokeHostContent: false keeps scraped text', () => {
    const input = group({
      subjectKind: 'website',
      scrapedData: {
        description: 'Brand copy',
        story: 'Brand story',
        textSourceUrl: 'https://other.example',
        textProvenance: { description: { sourceUrl: 'https://other.example' } },
      },
    })

    const application = applyRevocation(brand, input, 'no-evidence', { revokeHostContent: false })

    expect(input.scrapedData?.description).toBe('Brand copy')
    expect(input.scrapedData?.story).toBe('Brand story')
    expect(input.scrapedData?.textSourceUrl).toBe('https://other.example')
    expect(input.scrapedData?.textProvenance).toEqual({
      description: { sourceUrl: 'https://other.example' },
    })
    expect(application.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('revokeHostContent: false keeps images', () => {
    const linksResult = linksOutput()
    const originalImageUrls = [...linksResult.scrapedImageUrls]
    const originalImageSources = [...linksResult.scrapedImageSources]
    const originalJsonLdImageUrls = [...linksResult.jsonLdImageUrls]
    const input = group({ subjectKind: 'website', linksResult })

    const application = applyRevocation(brand, input, 'no-evidence', { revokeHostContent: false })

    expect(input.linksResult?.scrapedImageUrls).toEqual(originalImageUrls)
    expect(input.linksResult?.scrapedImageSources).toEqual(originalImageSources)
    expect(input.linksResult?.jsonLdImageUrls).toEqual(originalJsonLdImageUrls)
    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(application.phaseResult.changedFields).toEqual(['purchase_website'])
  })

  it('columns option scopes the revoke to the named columns', () => {
    const input = group({
      subjectKind: 'website',
      columns: ['purchase_website', 'social_instagram'],
      patch: {
        purchase_website: 'https://other.example',
        social_instagram: 'https://www.instagram.com/real-brand',
      },
    })

    const application = applyRevocation(brand, input, 'no-evidence', { columns: ['purchase_website'], revokeHostContent: false })

    expect(input.patch).not.toHaveProperty('purchase_website')
    expect(input.patch.social_instagram).toBe('https://www.instagram.com/real-brand')
    expect(application.phaseResult.changedFields).toEqual(['purchase_website'])
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

  it('revokes text sourced from the revoked page', () => {
    const input = textGroup()

    const application = applyRevocation(brand, input, 'wrong')

    expect(input.scrapedData?.description).toBeNull()
    expect(input.scrapedData?.story).toBeNull()
    expect(input.scrapedData?.textProvenance).toBeUndefined()
    expect(input.scrapedData?.textSourceUrl).toBeUndefined()
    expect(application.phaseResult.changedFields).toContain('description')
    expect(application.phaseResult.changedFields).toContain('story')
  })

  // The stored column is deliberately untouched: `textProvenance` describes THIS
  // run only, and nothing records the source of a description written by an
  // earlier one. Clearing it would destroy legitimate copy on a host that later
  // serves one bad page.
  it('does not add text fields to _cleared_fields', () => {
    const input = textGroup()

    const application = applyRevocation({ ...brand, description: 'Stored copy' }, input, 'wrong')

    expect(application.patch._cleared_fields ?? []).not.toContain('description')
  })

  // Same rule the image filter follows: text whose source page is unknown is
  // released, not struck. Releasing is the safe direction.
  it('leaves text with no provenance alone', () => {
    const input = textGroup({
      scrapedData: { description: 'Unprovenanced copy', story: null },
    })

    applyRevocation(brand, input, 'wrong')

    expect(input.scrapedData?.description).toBe('Unprovenanced copy')
  })

  it('leaves text sourced from a different page alone', () => {
    const input = textGroup({
      scrapedData: {
        description: 'Official copy',
        story: null,
        textProvenance: { description: { sourceUrl: 'https://official.example' } },
        textSourceUrl: 'https://official.example',
      },
    })

    applyRevocation(brand, input, 'wrong')

    expect(input.scrapedData?.description).toBe('Official copy')
    expect(input.scrapedData?.textSourceUrl).toBe('https://official.example')
  })

  // A source-page subject owns its own subtree, not the whole host — the same
  // asymmetry `filterRevokedImages` already applies to images.
  it('a source-page verdict does not revoke text from a sibling page on the same host', () => {
    const input = textGroup({
      subjectUrl: 'https://www.facebook.com/impostor',
      scrapedData: {
        description: 'Real brand page copy',
        story: null,
        textProvenance: { description: { sourceUrl: 'https://www.facebook.com/realbrand' } },
      },
    })

    applyRevocation(brand, input, 'wrong')

    expect(input.scrapedData?.description).toBe('Real brand page copy')
  })

  // A website subject owns the whole domain, so every page under it goes.
  it('a website verdict revokes text from any page on that host', () => {
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

    applyRevocation(brand, input, 'wrong')

    expect(input.scrapedData?.description).toBeNull()
  })
})

/**
 * The agent already judges page ownership inside its critique (`urlVerdicts`),
 * so the acquire phase does not spend a second LLM call re-asking it.
 * `verdictsFromCritique` is the adapter between the two vocabularies:
 * critique verdicts are keyed by the URL the model was shown, quarantine groups
 * by the subject URL the scrape recorded, and those two spellings of one page
 * differ by scheme, `www.` and a trailing slash more often than not.
 */
describe('verdictsFromCritique', () => {
  const quarantine = {
    'https://other.example': group(),
    'https://shop.example/store/abc': group({
      subjectUrl: 'https://shop.example/store/abc',
      columns: ['purchase_shopee'],
    }),
  }

  it('maps a critique verdict onto the quarantine subject it judges', () => {
    const verdicts = verdictsFromCritique(
      [
        {
          url: 'https://www.other.example/',
          owned: false,
          confidence: 'high',
          reason: 'the page belongs to a different maker',
        },
      ],
      brand.slug,
      quarantine,
    )

    expect(verdicts.size).toBe(1)
    expect(verdicts.get(siteIdentityKey(brand.slug, 'https://other.example'))).toEqual({
      slug: brand.slug,
      owned: false,
      confidence: 'high',
      reason: 'the page belongs to a different maker',
    })
  })

  it('ignores a verdict about a url no quarantine group holds', () => {
    const verdicts = verdictsFromCritique(
      [
        {
          url: 'https://unrelated.example/about',
          owned: false,
          confidence: 'high',
          reason: 'not the brand',
        },
      ],
      brand.slug,
      quarantine,
    )

    expect(verdicts.size).toBe(0)
  })

  it('keys each subject separately so one verdict cannot revoke another page', () => {
    const verdicts = verdictsFromCritique(
      [
        { url: 'https://other.example', owned: false, confidence: 'high', reason: 'wrong maker' },
        { url: 'https://shop.example/store/abc', owned: true, confidence: 'high', reason: 'official store' },
      ],
      brand.slug,
      quarantine,
    )

    expect(verdicts.get(siteIdentityKey(brand.slug, 'https://other.example'))?.owned).toBe(false)
    expect(
      verdicts.get(siteIdentityKey(brand.slug, 'https://shop.example/store/abc'))?.owned,
    ).toBe(true)
  })
})
