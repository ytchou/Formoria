import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { captureReadFailure } from '@/lib/degraded-render'
import { excludeTestBrands } from './public-brand-filter'

/**
 * A non-zero verified share must never render as `0%` — "3 of 697 brands are
 * MIT-verified (0%)" contradicts itself and undercuts the verification ladder,
 * which is the product's core trust signal. Sub-1% shares keep one decimal;
 * everything else stays a whole number.
 *
 * Floor of 0.1 caps the honest range at ~1 verified brand per 1000. Below that
 * it overstates; switch to a `<0.1%` display string if the directory ever gets
 * there.
 */
export function formatSharePercentage(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0
  const raw = (part / total) * 100
  if (raw >= 1) return Math.round(raw)
  return Math.max(Math.round(raw * 10) / 10, 0.1)
}

export type StatsPageData = {
  totalBrands: number
  categoryBreakdown: Array<{
    slug: string
    count: number
  }>
  cityCoverage: Array<{
    city: string
    count: number
  }>
  mitVerifiedShare: {
    verified: number
    total: number
    percentage: number
  }
  foundingDecadeDistribution: Array<{
    decade: number
    count: number
  }>
  /** True when any underlying read failed, so the caller can keep this render out of the ISR cache. */
  degraded: boolean
}

type BrandRow = {
  product_type: string | null
  founding_year: number | null
  city: string | null
}

async function getStatsPageDataImpl(): Promise<StatsPageData> {
  const supabase = createServiceClient()

  const [totalResult, categoryResult, cityResult, mitResult, foundingResult] = await Promise.all([
    (async () => {
      const { count, error } = await excludeTestBrands(
        supabase.from('brands').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      )
      if (error) throw error
      return { count }
    })().catch(captureReadFailure('stats.totalBrands')),
    (async () => {
      const { data, error } = await excludeTestBrands(
        supabase.from('brands').select('product_type').eq('status', 'approved'),
      ).not('product_type', 'is', null)
      if (error) throw error
      return { data: data as BrandRow[] | null }
    })().catch(captureReadFailure('stats.categoryBreakdown')),
    (async () => {
      const { data, error } = await excludeTestBrands(
        supabase.from('brands').select('city').eq('status', 'approved'),
      ).not('city', 'is', null)
      if (error) throw error
      return { data: data as BrandRow[] | null }
    })().catch(captureReadFailure('stats.cityCoverage')),
    (async () => {
      const { count, error } = await excludeTestBrands(
        supabase
          .from('brands')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved')
          .eq('mit_status', 'verified'),
      )
      if (error) throw error
      return { count }
    })().catch(captureReadFailure('stats.mitVerified')),
    (async () => {
      const { data, error } = await excludeTestBrands(
        supabase.from('brands').select('founding_year').eq('status', 'approved'),
      ).not('founding_year', 'is', null)
      if (error) throw error
      return { data: data as BrandRow[] | null }
    })().catch(captureReadFailure('stats.foundingDecades')),
  ])

  // ANY failed read degrades the render; the figures that DID resolve still render,
  // so one broken query does not blank the whole page.
  const degraded = [totalResult, categoryResult, cityResult, mitResult, foundingResult].some(
    (result) => result === null,
  )

  const totalBrands = totalResult?.count ?? 0
  const categoryCounts = new Map<string, number>()
  for (const row of categoryResult?.data ?? []) {
    if (!row.product_type) continue
    categoryCounts.set(row.product_type, (categoryCounts.get(row.product_type) ?? 0) + 1)
  }

  const categoryBreakdown = Array.from(categoryCounts.entries())
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count)

  const cityCounts = new Map<string, number>()
  for (const row of cityResult?.data ?? []) {
    if (!row.city) continue
    cityCounts.set(row.city, (cityCounts.get(row.city) ?? 0) + 1)
  }

  const cityCoverage = Array.from(cityCounts.entries())
    .map(([city, count]) => ({
      city,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const verified = mitResult?.count ?? 0
  const percentage = formatSharePercentage(verified, totalBrands)

  const currentYear = new Date().getFullYear()
  const decadeCounts = new Map<number, number>()
  for (const row of foundingResult?.data ?? []) {
    const year = row.founding_year
    if (typeof year !== 'number' || year < 1900 || year > currentYear) continue
    const decade = Math.floor(year / 10) * 10
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1)
  }

  const foundingDecadeDistribution = Array.from(decadeCounts.entries())
    .map(([decade, count]) => ({
      decade,
      count,
    }))
    .sort((a, b) => a.decade - b.decade)

  return {
    totalBrands,
    categoryBreakdown,
    mitVerifiedShare: {
      verified,
      total: totalBrands,
      percentage,
    },
    cityCoverage,
    foundingDecadeDistribution,
    degraded,
  }
}

export const getStatsPageData = cache(getStatsPageDataImpl)
