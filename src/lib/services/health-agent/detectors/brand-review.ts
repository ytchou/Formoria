/**
 * Brand review detector — reviews recently approved/edited brands for
 * content quality issues.
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/brand-review.ts`.
 */

import {
  evaluateBrandReview,
  type RecentBrandEdit,
} from '../../../../../scripts/health-agent/brand-review'
import type { HealthFinding } from '../contracts'
import { pagedRead, type PageableQuery } from '../paged-read'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

type BrandReviewSupabase = {
  from: (table: string) => PageableQuery<Record<string, unknown>>
}

export type BrandReviewDeps = {
  supabase: BrandReviewSupabase
}

/** How far back from now to look for recently edited brands (ms). */
const REVIEW_WINDOW_HOURS = 24

export function brandReviewDetector(deps: BrandReviewDeps): Detector {
  return {
    name: 'brand-review',
    source: 'directory',
    schedule: 'nightly',
    severity: 'medium',

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const nowMs = new Date(`${ctx.date}T04:50:00+08:00`).getTime()
      const windowStartMs = nowMs - REVIEW_WINDOW_HOURS * 60 * 60 * 1000
      const windowStartIso = new Date(windowStartMs).toISOString()
      const nowIso = new Date(nowMs).toISOString()

      const brands = await pagedRead<Record<string, unknown>>(
        deps.supabase,
        'brands',
        {
          select:
            'id,name,description,description_en,purchase_website,purchase_pinkoi,purchase_shopee,social_instagram,social_threads,social_facebook,other_urls',
          orderBy: [{ column: 'id', ascending: true }],
          filters: [{ column: 'status', value: 'approved' }],
        },
      )

      const edits: RecentBrandEdit[] = brands.map((b) => ({
        id: String(b.id),
        name: String(b.name ?? ''),
        description: (b.description as string | null) ?? null,
        descriptionEn: (b.description_en as string | null) ?? null,
        purchaseWebsite: (b.purchase_website as string | null) ?? null,
        purchasePinkoi: (b.purchase_pinkoi as string | null) ?? null,
        purchaseShopee: (b.purchase_shopee as string | null) ?? null,
        socialInstagram: (b.social_instagram as string | null) ?? null,
        socialThreads: (b.social_threads as string | null) ?? null,
        socialFacebook: (b.social_facebook as string | null) ?? null,
        otherUrls:
          (b.other_urls as { label: string; url: string }[] | null) ?? null,
      }))

      const result = evaluateBrandReview(edits, nowIso, windowStartIso)
      return result.findings
    },
  }
}
