import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export type StatsPageData = {
  totalBrands: number
  categoryBreakdown: Array<{
    category: string
    slug: string
    count: number
  }>
  mitVerifiedShare: {
    verified: number
    total: number
    percentage: number
  }
  foundingDecadeDistribution: Array<{
    decade: string
    count: number
  }>
}

type BrandRow = {
  product_type: string | null
  founding_year: number | null
}

function getProductTypeMeta(productType: string): { category: string; slug: string } {
  const match = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === productType)
  return {
    category: match?.name ?? productType,
    slug: match?.slug ?? productType,
  }
}

async function getStatsPageDataImpl(): Promise<StatsPageData> {
  const supabase = createServiceClient()

  const [totalResult, categoryResult, mitResult, foundingResult] = await Promise.all([
    (async () => {
      try {
        return await supabase.from('brands').select('*', { count: 'exact', head: true }).eq('status', 'approved')
      } catch {
        return { count: 0 }
      }
    })(),
    (async () => {
      try {
        return await supabase.from('brands').select('product_type').eq('status', 'approved').not('product_type', 'is', null)
      } catch {
        return { data: [] as BrandRow[] }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('brands')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved')
          .eq('mit_status', 'verified')
      } catch {
        return { count: 0 }
      }
    })(),
    (async () => {
      try {
        return await supabase.from('brands').select('founding_year').eq('status', 'approved').not('founding_year', 'is', null)
      } catch {
        return { data: [] as BrandRow[] }
      }
    })(),
  ])

  const totalBrands = totalResult.count ?? 0
  const categoryCounts = new Map<string, number>()
  for (const row of categoryResult.data ?? []) {
    if (!row.product_type) continue
    categoryCounts.set(row.product_type, (categoryCounts.get(row.product_type) ?? 0) + 1)
  }

  const categoryBreakdown = Array.from(categoryCounts.entries())
    .map(([productType, count]) => {
      const meta = getProductTypeMeta(productType)
      return {
        category: meta.category,
        slug: meta.slug,
        count,
      }
    })
    .sort((a, b) => b.count - a.count)

  const verified = mitResult.count ?? 0
  const percentage = totalBrands > 0 ? Math.round((verified / totalBrands) * 100) : 0

  const currentYear = new Date().getFullYear()
  const decadeCounts = new Map<number, number>()
  for (const row of foundingResult.data ?? []) {
    const year = row.founding_year
    if (typeof year !== 'number' || year < 1900 || year > currentYear) continue
    const decade = Math.floor(year / 10) * 10
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1)
  }

  const foundingDecadeDistribution = Array.from(decadeCounts.entries())
    .map(([decade, count]) => ({
      decade: `${decade}s`,
      count,
    }))
    .sort((a, b) => parseInt(a.decade) - parseInt(b.decade))

  return {
    totalBrands,
    categoryBreakdown,
    mitVerifiedShare: {
      verified,
      total: totalBrands,
      percentage,
    },
    foundingDecadeDistribution,
  }
}

export const getStatsPageData = cache(getStatsPageDataImpl)
