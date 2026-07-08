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
import { BrandDashboardShell } from '@/components/dashboard/brand-dashboard-shell'
import { getLatestReview } from '../../_lib/latest-review'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function AnalyticsPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const brand = await getBrandBySlug(slug)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [analytics, series, breakdown, sources, latestReview] =
    await Promise.all([
      getAnalytics(brand.id, 30),
      getDailySeries(brand.id, 90),
      getLinkClickBreakdown(brand.id, 90),
      getSourceBreakdown(brand.id, 30),
      user
        ? getLatestReview({ brandId: brand.id }, user)
        : Promise.resolve(null),
    ])

  return (
    <BrandDashboardShell
      brandName={brand.name}
      brandSlug={brand.slug}
      latestReview={latestReview}
    >
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
    </BrandDashboardShell>
  )
}
