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

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * One approved brand's content gaps, or null when it has none.
 *
 * The hero check mirrors what the site renders (`brands.ts` heroImageUrl):
 * `hero_image_storage_path` first, the legacy `hero_image_url` as fallback.
 */
export function approvedBrandGap(
  b: Record<string, unknown>,
): ApprovedBrandInvariantGap | null {
  const missingHeroImage =
    !hasText(b.hero_image_storage_path) && !hasText(b.hero_image_url)
  const descriptionTooShort =
    typeof b.description !== 'string' || b.description.trim().length < 20
  const missingApprovedAt = b.approved_at === null

  if (!missingHeroImage && !descriptionTooShort && !missingApprovedAt) {
    return null
  }
  return {
    brandId: String(b.id),
    missingHeroImage,
    descriptionTooShort,
    missingApprovedAt,
  }
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
          select:
            'id,hero_image_storage_path,hero_image_url,description,approved_at,created_at',
          orderBy: [{ column: 'id', ascending: true }],
          filters: [{ column: 'status', value: 'approved' }],
        },
      )

      const totalApproved = brands.length
      const addedToday = brands.filter(
        (b) =>
          typeof b.created_at === 'string' && b.created_at >= todayStart,
      ).length

      const gaps = brands
        .map(approvedBrandGap)
        .filter((gap): gap is ApprovedBrandInvariantGap => gap !== null)

      const result = evaluateApprovedBrandInvariants({
        totalApproved,
        addedToday,
        gaps,
      })

      return result.findings
    },
  }
}
