/**
 * Links-weekly detector — orchestrates all weekly link-check classes.
 *
 * Each class is injected as a dependency so tests can stub individual
 * checkers without vi.mock. The detector never throws; a class error
 * becomes a finding.
 */

import type { HealthFinding } from '../contracts'
import { stableFingerprint } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import type { LinkCheckClassResult } from '../../link-checks/types'

// ---------------------------------------------------------------------------
// DI seam — one function per link-check class
// ---------------------------------------------------------------------------

export type LinksWeeklyDeps = {
  checkSocialLinks: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkBrandOtherUrls: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkBrandChannelLinks: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkEventLinks: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkBrandImageLinks: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkCuratedProductLinks: (args: {
    supabase: unknown
    checkUrl: unknown
    requireNonEmpty?: boolean
  }) => Promise<LinkCheckClassResult>
  checkMdxLinks: (args: {
    links: unknown[]
    checkUrl: unknown
  }) => Promise<LinkCheckClassResult>
}

// ---------------------------------------------------------------------------
// Class registry
// ---------------------------------------------------------------------------

type ClassEntry = {
  name: string
  run: (ctx: DetectorContext, deps: LinksWeeklyDeps) => Promise<LinkCheckClassResult>
}

const CLASSES: ClassEntry[] = [
  {
    name: 'social',
    run: (ctx, deps) =>
      deps.checkSocialLinks({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
        requireNonEmpty: true,
      }),
  },
  {
    name: 'brand-other-urls',
    run: (ctx, deps) =>
      deps.checkBrandOtherUrls({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
        requireNonEmpty: true,
      }),
  },
  {
    name: 'brand-channels',
    run: (ctx, deps) =>
      deps.checkBrandChannelLinks({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
      }),
  },
  {
    name: 'events',
    run: (ctx, deps) =>
      deps.checkEventLinks({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
      }),
  },
  {
    name: 'brand-images',
    run: (ctx, deps) =>
      deps.checkBrandImageLinks({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
      }),
  },
  {
    name: 'curated-products',
    run: (ctx, deps) =>
      deps.checkCuratedProductLinks({
        supabase: ctx.deps.supabase,
        checkUrl: ctx.deps.checkUrl,
        requireNonEmpty: true,
      }),
  },
  {
    name: 'mdx',
    run: (ctx, deps) =>
      deps.checkMdxLinks({
        links: (ctx.deps.mdxLinks as unknown[]) ?? [],
        checkUrl: ctx.deps.checkUrl,
      }),
  },
]

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function linksWeeklyDetector(deps: LinksWeeklyDeps): Detector {
  return {
    name: 'social', // first class name — overridden by runner's per-class names
    source: 'links-weekly',
    schedule: 'weekly',
    severity: 'medium',

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const findings: HealthFinding[] = []

      for (const entry of CLASSES) {
        let result: LinkCheckClassResult

        try {
          result = await entry.run(ctx, deps)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          findings.push({
            source: 'links-weekly',
            fingerprint: stableFingerprint(
              'links-weekly',
              'class-failure',
              entry.name,
            ),
            title: `Link check class "${entry.name}" failed: ${message}`,
            severity: 'high',
            evidence: { error: message, className: entry.name },
            mergePolicy: 'human',
          })
          continue
        }

        // Surface class-level errors as findings
        if (result.error) {
          findings.push({
            source: 'links-weekly',
            fingerprint: stableFingerprint(
              'links-weekly',
              'class-failure',
              entry.name,
            ),
            title: `Link check class "${entry.name}" reported an error: ${result.error}`,
            severity: 'high',
            evidence: {
              error: result.error,
              className: entry.name,
              checked: result.checked,
            },
            mergePolicy: 'human',
          })
        }

        // Collect all class findings
        findings.push(...result.findings)
      }

      return findings
    },
  }
}
