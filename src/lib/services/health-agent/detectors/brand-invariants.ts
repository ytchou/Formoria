/**
 * Brand invariants detector — checks approved brands for content gaps.
 *
 * Copies the pure evaluate function from `scripts/health-agent/directory.ts`
 * and replaces the data access with paged reads through Supabase.
 */

import {
  evaluateApprovedBrandInvariants,
  type ApprovedBrandInvariantGap,
} from '../../../../../scripts/health-agent/directory'
import type { HealthFinding } from '../contracts'
import { pagedRead, type PageableQuery } from '../paged-read'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

type BrandInvariantsSupabase = {
  from: (table: string) => PageableQuery<Record<string, unknown>>
}

export type BrandInvariantsDeps = {
  supabase: BrandInvariantsSupabase
}

export function brandInvariantsDetector(deps: BrandInvariantsDeps): Detector {
  return {
    name: 'brand-invariants',
    source: 'directory',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {},

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const todayStart = `${ctx.date}T00:00:00+08:00`

      // Read all approved brands with a paged read
      const brands = await pagedRead<Record<string, unknown>>(
        deps.supabase,
        'brands',
        {
          select: 'id,hero_image_url,description,approved_at,created_at',
          orderBy: [{ column: 'id', ascending: true }],
          filters: [{ column: 'status', value: 'approved' }],
        },
      )

      const totalApproved = brands.length
      const addedToday = brands.filter(
        (b) =>
          typeof b.created_at === 'string' && b.created_at >= todayStart,
      ).length

      const gaps: ApprovedBrandInvariantGap[] = brands
        .filter(
          (b) =>
            !b.hero_image_url ||
            (typeof b.hero_image_url === 'string' &&
              b.hero_image_url.trim() === '') ||
            !b.description ||
            (typeof b.description === 'string' &&
              b.description.trim().length < 20) ||
            b.approved_at === null,
        )
        .map((b) => ({
          brandId: String(b.id),
          missingHeroImage:
            !b.hero_image_url ||
            (typeof b.hero_image_url === 'string' &&
              b.hero_image_url.trim() === ''),
          descriptionTooShort:
            !b.description ||
            (typeof b.description === 'string' &&
              b.description.trim().length < 20),
          missingApprovedAt: b.approved_at === null,
        }))

      const result = evaluateApprovedBrandInvariants({
        totalApproved,
        addedToday,
        gaps,
      })

      return result.findings
    },
  }
}
