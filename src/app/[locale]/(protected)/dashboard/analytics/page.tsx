import { setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import {
  getAnalytics,
  getDailySeries,
  getLinkClickBreakdown,
  getSourceBreakdown,
} from '@/lib/services/brand-analytics'
import { AnalyticsCards } from '@/components/dashboard/analytics-cards'
import { AnalyticsChart } from '@/components/dashboard/analytics-chart'
import { LinkBreakdown } from '@/components/dashboard/link-breakdown'
import { SourcesBreakdownCard } from '@/components/dashboard/sources-breakdown-card'
import { resolveBrand } from '../_lib/resolve-brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const selectedBrand = await resolveBrand(resolvedSearchParams, user.id, user.email)
  if (!selectedBrand) return null

  const brand = await getBrandBySlug(selectedBrand.brandSlug)
  const [analytics, series, breakdown, sources] = await Promise.all([
    getAnalytics(brand.id, 30),
    getDailySeries(brand.id, 90),
    getLinkClickBreakdown(brand.id, 90),
    getSourceBreakdown(brand.id, 30),
  ])

  return (
    <div className="space-y-6">
      <AnalyticsCards
        totalViews={analytics.totalViews}
        totalClicks={analytics.totalClicks}
        viewTrend={analytics.viewTrend}
        clickTrend={analytics.clickTrend}
      />
      <SourcesBreakdownCard sources={sources} />
      <AnalyticsChart series={series} />
      <LinkBreakdown rows={breakdown} />
    </div>
  )
}
