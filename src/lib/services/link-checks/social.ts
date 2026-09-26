/**
 * Social link checker — checks social media URLs on approved brands.
 *
 * Platforms: Instagram, Facebook, Threads (the three columns on `brands`).
 *
 * NOT-FOUND vs BLOCKED:
 * - A 404/410 on a social URL is a dead link (the profile does not exist).
 * - A 403/429 or redirect to a login page is a blocked probe — the profile
 *   may still be live, so we record it in the summary but never as a finding.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { pagedRead } from '@/lib/services/health-agent/paged-read'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult, LinkCheckClient } from './types'
import { LINK_CHECK_CONCURRENCY, MAX_DEAD_LINKS_PER_FINDING } from './types'

// ---------------------------------------------------------------------------
// Social column registry
// ---------------------------------------------------------------------------

const SOCIAL_COLUMNS = [
  'social_instagram',
  'social_facebook',
  'social_threads',
] as const

type SocialColumn = (typeof SOCIAL_COLUMNS)[number]

/**
 * Login-wall paths the platforms redirect an anonymous probe to. Facebook
 * answers a scripted HEAD with a redirect to `/login/?next=...` and then a
 * 400, so the status code alone reads as dead even though the profile is
 * live. A probe that ends on one of these paths is blocked, never dead.
 */
const LOGIN_WALL_PATHS = ['/login', '/accounts/login']

function isLoginWall(resolvedUrl: string | null): boolean {
  if (!resolvedUrl) return false
  try {
    const { pathname } = new URL(resolvedUrl)
    return LOGIN_WALL_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type BrandSocialRow = {
  id: string
  slug: string
} & Record<SocialColumn, string | null>

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckSocialDeps = {
  supabase: LinkCheckClient
  checkUrl: (url: string) => Promise<CheckUrlResult>
  /** When true, a zero-row read becomes a detector failure. */
  requireNonEmpty?: boolean
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  brandId: string
  brandSlug: string
  column: SocialColumn
  url: string
  statusCode: number | null
}

export async function checkSocialLinks(
  deps: CheckSocialDeps,
): Promise<LinkCheckClassResult> {
  const selectCols = ['id', 'slug', ...SOCIAL_COLUMNS].join(', ')

  let brands: BrandSocialRow[]
  try {
    brands = await pagedRead<BrandSocialRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'brands',
      {
        orderBy: [{ column: 'id' }],
        select: selectCols,
        filters: [{ column: 'status', value: 'approved' }],
        requireNonEmpty: deps.requireNonEmpty,
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      checked: 0,
      dead: 0,
      blocked: 0,
      error: message,
      findings: [
        {
          source: 'links-weekly',
          fingerprint: stableFingerprint('links-weekly', 'zero-rows', 'social'),
          title: 'Social link checker read zero brands',
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        },
      ],
    }
  }

  // Collect all (brand, column, url) triples
  const tasks: Array<{
    brand: BrandSocialRow
    column: SocialColumn
    url: string
  }> = []
  for (const brand of brands) {
    for (const col of SOCIAL_COLUMNS) {
      const url = brand[col]
      if (url) tasks.push({ brand, column: col, url })
    }
  }

  if (tasks.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(tasks, LINK_CHECK_CONCURRENCY, async (task) => {
    const result = await deps.checkUrl(task.url)
    if (result.status === 'blocked' || isLoginWall(result.resolvedUrl)) {
      blocked += 1
    } else if (result.status === 'broken') {
      dead += 1
      deadLinks.push({
        brandId: task.brand.id,
        brandSlug: task.brand.slug,
        column: task.column,
        url: task.url,
        statusCode: result.statusCode,
      })
    }
  })

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-social-links', 'batch'),
      title: `${deadLinks.length} dead social link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: tasks.length, dead, blocked, findings }
}
