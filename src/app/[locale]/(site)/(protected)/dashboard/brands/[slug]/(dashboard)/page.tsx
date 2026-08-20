import { setRequestLocale } from 'next-intl/server'
import { captureReadFailure } from '@/lib/degraded-render'
import { getBrandBySlug } from '@/lib/services/brands'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'
import { getPostHogOwnerAnalyticsSnapshot } from '@/lib/services/posthog-owner-analytics'
import { OverviewInlineAnalytics } from '@/components/dashboard/overview-inline-analytics'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { TodoSection } from '@/components/dashboard/todo-section'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function BrandOverviewPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const sp = await searchParams
  const periodRaw = typeof sp.period === 'string' ? parseInt(sp.period, 10) : 30
  const period = [7, 30, 90].includes(periodRaw) ? (periodRaw as 7 | 30 | 90) : 30

  const brand = await getBrandBySlug(slug)
  const completeness = computeProfileCompleteness(brand)

  const [analytics] = await Promise.all([
    getPostHogOwnerAnalyticsSnapshot(brand.id, { daysBack: period }).catch(
      captureReadFailure('dashboard-brand-overview-analytics'),
    ),
  ])

  return (
    <div className="space-y-stack" data-testid="brand-profile">
      <QuickActions brandSlug={slug} />
      <TodoSection completeness={completeness} slug={slug} mitStatus={brand.mitStatus ?? 'unverified'} />
      <OverviewInlineAnalytics snapshot={analytics} period={period} />
    </div>
  )
}
