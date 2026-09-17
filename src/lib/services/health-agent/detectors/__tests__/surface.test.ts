import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { surfaceDetector } from '../surface'
import type { AssertionResult } from '@/lib/services/surface-assertions'

function makeCtx(
  deps: Record<string, unknown> = {},
): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps,
  }
}

describe('surface detector', () => {
  it('runs all assertions including brand detail pages and compares the sitemap count with the approved-brand count', async () => {
    const failedAssertion: AssertionResult = {
      name: 'sitemap',
      ok: false,
      detail: 'sitemap contains 10 brand URLs, expected >= 50',
    }
    const passedAssertion: AssertionResult = {
      name: 'robots',
      ok: true,
      detail: 'robots.txt allows crawling',
    }

    const runAllAssertions = async () => [failedAssertion, passedAssertion]

    // Sitemap brand count differs from approved brand count
    const sitemapBrandCount = 10
    const approvedBrandCount = 700

    const ctx = makeCtx({
      runAllAssertions,
      env: { PRODUCTION_BASE_URL: 'https://formoria.com' },
      getApprovedBrandCount: async () => approvedBrandCount,
      getSitemapBrandCount: async () => sitemapBrandCount,
    })

    const findings = await surfaceDetector.run(ctx)

    // Should have findings for:
    // 1. The failed assertion (sitemap)
    // 2. The sitemap vs approved brand count mismatch
    expect(findings.length).toBeGreaterThanOrEqual(2)
    expect(findings.some((f) => f.title.includes('sitemap'))).toBe(true)
    expect(findings.some((f) => f.title.match(/brand.*count|sitemap.*mismatch/i))).toBe(true)
  })

  it('returns no findings when all assertions pass and counts match', async () => {
    const assertions: AssertionResult[] = [
      { name: 'sitemap', ok: true, detail: '700 brand URLs in sitemap' },
      { name: 'robots', ok: true, detail: 'robots.txt allows crawling' },
      { name: 'og-image', ok: true, detail: 'og:image is reachable' },
      { name: 'brand-page', ok: true, detail: 'brand page has JSON-LD and a purchase link' },
    ]

    const runAllAssertions = async () => assertions

    const ctx = makeCtx({
      runAllAssertions,
      env: { PRODUCTION_BASE_URL: 'https://formoria.com' },
      getApprovedBrandCount: async () => 700,
      getSitemapBrandCount: async () => 700,
    })

    const findings = await surfaceDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await surfaceDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
