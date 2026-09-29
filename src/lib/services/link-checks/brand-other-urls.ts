/**
 * Brand other-URLs link checker.
 *
 * Checks the JSON `other_urls` column on approved brands. Each entry is
 * `{ label: string; url: string }`. Dead links are reported; blocked probes
 * are counted but never surface as findings.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { pagedRead } from '@/lib/services/health-agent/paged-read'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult, LinkCheckClient } from './types'
import { LINK_CHECK_CONCURRENCY, MAX_DEAD_LINKS_PER_FINDING } from './types'

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type OtherUrlEntry = { label: string; url: string }

type BrandOtherUrlsRow = {
  id: string
  slug: string
  other_urls: OtherUrlEntry[] | unknown
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckBrandOtherUrlsDeps = {
  supabase: LinkCheckClient
  checkUrl: (url: string) => Promise<CheckUrlResult>
  requireNonEmpty?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOtherUrls(raw: unknown): OtherUrlEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry): entry is OtherUrlEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).url === 'string' &&
      // An empty entry is a blank form row, not a link; there is nothing to probe.
      ((entry as Record<string, unknown>).url as string).trim() !== '',
  )
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  brandId: string
  brandSlug: string
  label: string
  url: string
  statusCode: number | null
}

export async function checkBrandOtherUrls(
  deps: CheckBrandOtherUrlsDeps,
): Promise<LinkCheckClassResult> {
  let brands: BrandOtherUrlsRow[]
  try {
    brands = await pagedRead<BrandOtherUrlsRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'brands',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, slug, other_urls',
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
          fingerprint: stableFingerprint('links-weekly', 'zero-rows', 'brand-other-urls'),
          title: 'Brand other-URLs checker read zero brands',
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        },
      ],
    }
  }

  const tasks: Array<{
    brand: BrandOtherUrlsRow
    entry: OtherUrlEntry
  }> = []
  for (const brand of brands) {
    for (const entry of parseOtherUrls(brand.other_urls)) {
      tasks.push({ brand, entry })
    }
  }

  if (tasks.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(tasks, LINK_CHECK_CONCURRENCY, async (task) => {
    const result = await deps.checkUrl(task.entry.url)
    if (result.status === 'blocked') {
      blocked += 1
    } else if (result.status === 'broken') {
      dead += 1
      deadLinks.push({
        brandId: task.brand.id,
        brandSlug: task.brand.slug,
        label: task.entry.label,
        url: task.entry.url,
        statusCode: result.statusCode,
      })
    }
  })

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-other-urls', 'batch'),
      title: `${deadLinks.length} dead other-URL(s) found`,
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
