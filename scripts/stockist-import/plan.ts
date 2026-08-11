import { normalizeChannelName } from '@/lib/brands/channels'
import type { ChannelCandidate } from '@/lib/types/brand-channel'
import { normalizeStockistRow, type StockistCsvRow } from './normalize'

export type ApprovedBrand = { id: string; slug: string }

export type BrandImportPlan = {
  brandId: string
  brandSlug: string
  candidates: ChannelCandidate[]
  heldBack: number
  collapsed: number
}

export type StockistImportPlan = {
  brands: BrandImportPlan[]
  unmatchedSlugs: string[]
  rejected: Array<{ brandSlug: string; reason: string }>
  totals: {
    publish: number
    upserts: number
    heldBack: number
    unmatched: number
    collapsed: number
    rejected: number
  }
}

function withRegionSuffix(base: string, region: string): string {
  const suffix = `:${region}`
  return `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`
}

export function planStockistImport(
  rawRows: StockistCsvRow[],
  approvedBrands: ApprovedBrand[],
): StockistImportPlan {
  const approvedBySlug = new Map(
    approvedBrands.map((brand) => [brand.slug, brand.id]),
  )
  const unmatchedSlugs = new Set<string>()
  const rejected: Array<{ brandSlug: string; reason: string }> = []
  const grouped = new Map<
    string,
    { brandId: string; publish: ChannelCandidate[]; heldBack: number }
  >()
  let unmatched = 0

  for (const raw of rawRows) {
    const normalized = normalizeStockistRow(raw)
    if (!normalized.ok) {
      rejected.push({
        brandSlug: normalized.brandSlug,
        reason: normalized.reason,
      })
      continue
    }
    const { brandSlug, sourceType, candidate } = normalized.row
    const brandId = approvedBySlug.get(brandSlug)
    if (!brandId) {
      unmatchedSlugs.add(brandSlug)
      unmatched++
      continue
    }
    const brand = grouped.get(brandSlug) ?? {
      brandId,
      publish: [],
      heldBack: 0,
    }
    if (sourceType === 'official_website') {
      brand.publish.push(candidate)
    } else {
      brand.heldBack++
    }
    grouped.set(brandSlug, brand)
  }

  const brands: BrandImportPlan[] = []
  let collapsed = 0
  let publish = 0
  for (const [brandSlug, group] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    publish += group.publish.length
    const byBaseAndRegion = new Map<string, ChannelCandidate>()
    for (const candidate of group.publish) {
      const base = normalizeChannelName(candidate.name)
      const key = `${base}\u0000${candidate.regionLabel ?? ''}`
      if (byBaseAndRegion.has(key)) {
        collapsed++
        continue
      }
      byBaseAndRegion.set(key, { ...candidate, normalizedName: base })
    }

    const byBase = new Map<string, ChannelCandidate[]>()
    for (const candidate of byBaseAndRegion.values()) {
      const base = candidate.normalizedName
      const candidates = byBase.get(base) ?? []
      candidates.push(candidate)
      byBase.set(base, candidates)
    }

    const candidates = [...byBase.values()].flatMap((collisions) =>
      collisions.length === 1
        ? collisions
        : collisions.map((candidate) => ({
            ...candidate,
            normalizedName: withRegionSuffix(
              candidate.normalizedName,
              candidate.regionLabel ?? candidate.country ?? 'unknown',
            ),
          })),
    )

    brands.push({
      brandId: group.brandId,
      brandSlug,
      candidates,
      heldBack: group.heldBack,
      collapsed: group.publish.length - candidates.length,
    })
  }

  return {
    brands,
    unmatchedSlugs: [...unmatchedSlugs].sort(),
    rejected,
    totals: {
      publish,
      upserts: brands.reduce((sum, brand) => sum + brand.candidates.length, 0),
      heldBack: brands.reduce((sum, brand) => sum + brand.heldBack, 0),
      unmatched,
      collapsed,
      rejected: rejected.length,
    },
  }
}
