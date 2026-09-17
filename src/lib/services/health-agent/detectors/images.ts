/**
 * Images detector — monitors brand_images for:
 * 1. Active rows whose storage_path still starts with `submissions/` after 24h
 * 2. Duplicate active sort_order per brand
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const SUBMISSIONS_PATH_AGE_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type ImageRow = {
  id: string
  brand_id: string
  status: string
  storage_path: string | null
  sort_order: number
  created_at: string
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const imagesDetector: Detector = {
  name: 'images',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'medium',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []
    const now = Date.now()

    const activeImages = await pagedRead<ImageRow>(
      supabase,
      'brand_images',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, brand_id, status, storage_path, sort_order, created_at',
        filters: [{ column: 'status', value: 'active' }],
      },
    )

    // 1. Rows still under submissions/ after 24 hours
    const ageCutoff = new Date(now - SUBMISSIONS_PATH_AGE_MS).toISOString()
    const staleSubmissions = activeImages.filter(
      (img) =>
        img.storage_path?.startsWith('submissions/') &&
        img.created_at < ageCutoff,
    )

    for (const img of staleSubmissions) {
      findings.push({
        source: 'pipeline',
        fingerprint: stableFingerprint(
          'pipeline',
          'submissions-path',
          img.id,
        ),
        title: `Image ${img.id} still under submissions/ after 24h`,
        severity: 'medium',
        evidence: {
          imageId: img.id,
          brandId: img.brand_id,
          storagePath: img.storage_path,
          createdAt: img.created_at,
        },
        mergePolicy: 'human',
      })
    }

    // 2. Duplicate active sort_order per brand
    const brandSortOrders = new Map<
      string,
      Map<number, string[]>
    >()

    for (const img of activeImages) {
      let sortMap = brandSortOrders.get(img.brand_id)
      if (!sortMap) {
        sortMap = new Map()
        brandSortOrders.set(img.brand_id, sortMap)
      }
      const ids = sortMap.get(img.sort_order) ?? []
      ids.push(img.id)
      sortMap.set(img.sort_order, ids)
    }

    for (const [brandId, sortMap] of brandSortOrders) {
      for (const [sortOrder, ids] of sortMap) {
        if (ids.length > 1) {
          findings.push({
            source: 'pipeline',
            fingerprint: stableFingerprint(
              'pipeline',
              'duplicate-sort-order',
              `${brandId}:${sortOrder}`,
            ),
            title: `Brand ${brandId} has ${ids.length} active images with sort_order ${sortOrder}`,
            severity: 'medium',
            evidence: {
              brandId,
              sortOrder,
              imageIds: ids,
              count: ids.length,
            },
            mergePolicy: 'human',
          })
        }
      }
    }

    return findings
  },
}
