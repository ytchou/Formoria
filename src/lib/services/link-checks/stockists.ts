/**
 * Stockist link checker — checks URLs on stockist rows that belong to
 * approved brands and have not been removed.
 *
 * Reads approved brand IDs first, then fetches stockist rows in `.in()`
 * chunks of 200 to stay within PostgREST URL length limits.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { pagedRead } from '@/lib/services/health-agent/paged-read'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult, LinkCheckClient } from './types'
import {
  IN_FILTER_CHUNK_SIZE,
  LINK_CHECK_CONCURRENCY,
  MAX_DEAD_LINKS_PER_FINDING,
} from './types'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type BrandIdRow = { id: string }

type StockistRow = {
  id: string
  brand_id: string
  url: string | null
  removed_at: string | null
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckStockistDeps = {
  supabase: LinkCheckClient
  checkUrl: (url: string) => Promise<CheckUrlResult>
  requireNonEmpty?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  stockistId: string
  brandId: string
  url: string
  statusCode: number | null
}

export async function checkStockistLinks(
  deps: CheckStockistDeps,
): Promise<LinkCheckClassResult> {
  // Step 1: get approved brand IDs
  const brands = await pagedRead<BrandIdRow>(
    deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
    'brands',
    {
      orderBy: [{ column: 'id' }],
      select: 'id',
      filters: [{ column: 'status', value: 'approved' }],
    },
  )

  const brandIds = brands.map((b) => b.id)

  // Step 2: read stockists in .in() chunks
  const allStockists: StockistRow[] = []
  for (const chunk of chunkArray(brandIds, IN_FILTER_CHUNK_SIZE)) {
    const rows = await pagedRead<StockistRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'stockists',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, brand_id, url, removed_at',
      },
    )
    // Filter to chunk brand_ids and active (not removed) rows with a URL
    const filtered = rows.filter(
      (r) =>
        chunk.includes(r.brand_id) &&
        r.url !== null &&
        r.removed_at === null,
    )
    allStockists.push(...filtered)
  }

  if (allStockists.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(
    allStockists,
    LINK_CHECK_CONCURRENCY,
    async (row) => {
      const result = await deps.checkUrl(row.url!)
      if (result.status === 'blocked') {
        blocked += 1
      } else if (result.status === 'broken') {
        dead += 1
        deadLinks.push({
          stockistId: row.id,
          brandId: row.brand_id,
          url: row.url!,
          statusCode: result.statusCode,
        })
      }
    },
  )

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-stockist-links', 'batch'),
      title: `${deadLinks.length} dead stockist link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: allStockists.length, dead, blocked, findings }
}
