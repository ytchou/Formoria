/**
 * Surface detector — runs all surface assertions (including brand detail
 * pages) and compares the sitemap brand count with the approved-brand count.
 *
 * Uses the shared `surface-assertions.ts` module and `PRODUCTION_BASE_URL`.
 */

import {
  runAllAssertions as defaultRunAllAssertions,
  type AssertionContext,
  type AssertionResult,
} from '@/lib/services/surface-assertions'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>
type RunAllAssertions = (ctx: AssertionContext) => Promise<AssertionResult[]>
type GetApprovedBrandCount = () => Promise<number>
type GetSitemapBrandCount = () => Promise<number>
type FetchFn = typeof fetch

function getEnv(ctx: DetectorContext): Env {
  return (ctx.deps.env as Env | undefined) ?? {}
}

function getRunAllAssertions(ctx: DetectorContext): RunAllAssertions {
  return (ctx.deps.runAllAssertions as RunAllAssertions | undefined) ?? defaultRunAllAssertions
}

function getApprovedBrandCountFn(ctx: DetectorContext): GetApprovedBrandCount | null {
  return (ctx.deps.getApprovedBrandCount as GetApprovedBrandCount | undefined) ?? null
}

function getSitemapBrandCountFn(ctx: DetectorContext): GetSitemapBrandCount | null {
  return (ctx.deps.getSitemapBrandCount as GetSitemapBrandCount | undefined) ?? null
}

function getFetch(ctx: DetectorContext): FetchFn {
  return (ctx.deps.fetch as FetchFn | undefined) ?? fetch
}

/**
 * Acceptable ratio of sitemap-to-approved brand count. If the sitemap
 * count is less than 80% of the approved count, it is a finding.
 */
const MIN_COVERAGE_RATIO = 0.8

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const surfaceDetector: Detector = {
  name: 'surface-assertions',
  source: 'surface',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const baseUrl = env.PRODUCTION_BASE_URL?.replace(/\/+$/, '')
    if (!baseUrl) return []

    const fetchFn = getFetch(ctx)
    const runAssertions = getRunAllAssertions(ctx)

    const assertionCtx: AssertionContext = {
      baseUrl,
      fetch: fetchFn,
    }

    const results = await runAssertions(assertionCtx)
    const findings: HealthFinding[] = []

    // Convert failed assertions to findings
    for (const result of results) {
      if (!result.ok) {
        findings.push({
          source: 'surface',
          fingerprint: stableFingerprint('surface', 'assertion', result.name),
          title: `Surface assertion "${result.name}" failed: ${result.detail}`,
          severity: 'high',
          evidence: { assertion: result.name, detail: result.detail },
          mergePolicy: 'human',
        })
      }
    }

    // Compare sitemap brand count with approved brand count
    const getApprovedCount = getApprovedBrandCountFn(ctx)
    const getSitemapCount = getSitemapBrandCountFn(ctx)
    if (getApprovedCount && getSitemapCount) {
      const [approvedCount, sitemapCount] = await Promise.all([
        getApprovedCount(),
        getSitemapCount(),
      ])

      if (approvedCount > 0 && sitemapCount < approvedCount * MIN_COVERAGE_RATIO) {
        findings.push({
          source: 'surface',
          fingerprint: stableFingerprint('surface', 'brand-count', 'sitemap-mismatch'),
          title: `Sitemap brand count mismatch: ${sitemapCount} in sitemap vs ${approvedCount} approved (${Math.round((sitemapCount / approvedCount) * 100)}% coverage)`,
          severity: 'high',
          evidence: { sitemapCount, approvedCount, coverageRatio: sitemapCount / approvedCount },
          mergePolicy: 'human',
        })
      }
    }

    return findings
  },
}
