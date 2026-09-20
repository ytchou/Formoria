/**
 * Brand images link checker — checks the `url` field on active brand_images
 * rows that belong to approved brands.
 *
 * Only active images are checked: rejected/pending images are not rendered
 * anywhere, so probing them buys nothing.
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

type ImageRow = {
  id: string
  brand_id: string
  url: string
  status: string
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckBrandImageDeps = {
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
  imageId: string
  brandId: string
  url: string
  statusCode: number | null
}

export async function checkBrandImageLinks(
  deps: CheckBrandImageDeps,
): Promise<LinkCheckClassResult> {
  // Step 1: get approved brand IDs
  const brands = await pagedRead<BrandIdRow>(
    deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
    'brands',
    {
      orderBy: [{ column: 'id' }],
      select: 'id',
      filters: [{ column: 'status', value: 'approved' }],
      requireNonEmpty: deps.requireNonEmpty,
    },
  )

  const brandIds = brands.map((b) => b.id)

  // Step 2: read active brand_images in .in() chunks
  const allImages: ImageRow[] = []
  for (const chunk of chunkArray(brandIds, IN_FILTER_CHUNK_SIZE)) {
    const rows = await pagedRead<ImageRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'brand_images',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, brand_id, url, status',
        filters: [{ column: 'status', value: 'active' }],
        requireNonEmpty: deps.requireNonEmpty,
      },
    )
    const filtered = rows.filter((r) => chunk.includes(r.brand_id))
    allImages.push(...filtered)
  }

  if (allImages.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(
    allImages,
    LINK_CHECK_CONCURRENCY,
    async (row) => {
      const result = await deps.checkUrl(row.url)
      if (result.status === 'blocked') {
        blocked += 1
      } else if (result.status === 'broken') {
        dead += 1
        deadLinks.push({
          imageId: row.id,
          brandId: row.brand_id,
          url: row.url,
          statusCode: result.statusCode,
        })
      }
    },
  )

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-image-links', 'batch'),
      title: `${deadLinks.length} dead brand image link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: allImages.length, dead, blocked, findings }
}
