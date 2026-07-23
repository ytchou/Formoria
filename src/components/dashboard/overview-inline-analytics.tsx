import { getTranslations } from 'next-intl/server'
import { AnalyticsBarChart } from '@/components/dashboard/analytics-bar-chart'
import { AnalyticsDonutCard } from '@/components/dashboard/analytics-donut-card'
import { AnalyticsTrendChart } from '@/components/dashboard/analytics-trend-chart'
import { SurfaceCard } from '@/components/ui/card'
import { countDelta, percent } from '@/lib/analytics/delta-formatters'
import type { OwnerAnalyticsSnapshotV1 } from '@/lib/analytics/posthog-types'
import { trafficSourceLabel } from '@/lib/analytics/traffic-source-labels'

export async function OverviewInlineAnalytics({
  snapshot,
  period,
}: {
  snapshot: OwnerAnalyticsSnapshotV1 | null
  period: number
}) {
  const [tOverview, tAnalytics, tSidebar, tPeriod] = await Promise.all([
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.analytics'),
    getTranslations('dashboard.sidebar'),
    getTranslations('dashboard.period'),
  ])
  const periodLabel = [7, 30, 90].includes(period)
    ? tPeriod(`${period}d`)
    : `${period}d`

  if (!snapshot) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="type-section-title">{tSidebar('analytics')}</h2>
          <span className="type-caption text-muted-foreground">{periodLabel}</span>
        </div>
        <SurfaceCard>
          <p className="type-body-muted">{tOverview('analyticsUnavailable')}</p>
        </SurfaceCard>
      </section>
    )
  }

  const trafficSourceLabels = {
    search: tAnalytics('trafficSourceSearch'),
    category: tAnalytics('trafficSourceCategory'),
    homepage: tAnalytics('trafficSourceHomepage'),
    direct: tAnalytics('trafficSourceDirect'),
    other: tAnalytics('trafficSourceOther'),
  }
  const profileDelta = snapshot.profileSessions
    ? countDelta(
        snapshot.profileSessions.current,
        snapshot.profileSessions.prior,
      )
    : undefined
  const hasTrend = snapshot.daily?.some(
    (point) => point.profileSessions > 0 || point.outboundSessions > 0,
  ) ?? false

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="type-section-title">{tSidebar('analytics')}</h2>
        <span className="type-caption text-muted-foreground">{periodLabel}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SurfaceCard padding="lg">
          <div className="flex items-start justify-between gap-3">
            <h3 className="type-card-title">{tAnalytics('trendTitle')}</h3>
            <div className="text-right">
              <p className="type-stat">
                {snapshot.profileSessions?.current ?? '—'}
              </p>
              {profileDelta ? (
                <p className="type-caption text-muted-foreground">
                  {profileDelta.text}
                </p>
              ) : null}
            </div>
          </div>
          {snapshot.daily && hasTrend ? (
            <div className="mt-4">
              <AnalyticsTrendChart
                data={snapshot.daily}
                labels={{
                  profile: tAnalytics('profileVisits'),
                  outbound: tAnalytics('outboundClicks'),
                  aria: tAnalytics('trendAria'),
                }}
              />
            </div>
          ) : (
            <p className="mt-4 type-body-muted">
              {snapshot.daily === null
                ? tAnalytics('trendUnavailable')
                : tAnalytics('trendEmpty')}
            </p>
          )}
        </SurfaceCard>

        <AnalyticsDonutCard
          centerLabel={percent(snapshot.topTrafficSource?.share ?? null)}
          emptyLabel={
            snapshot.trafficSources === null
              ? tAnalytics('sectionUnavailable')
              : tAnalytics('trafficSourcesEmpty')
          }
          rows={(snapshot.trafficSources ?? []).map((row) => ({
            key: row.source,
            label: trafficSourceLabel(row.source, trafficSourceLabels),
            sessions: row.sessions,
          }))}
          title={tAnalytics('trafficSources')}
        />

        <SurfaceCard padding="lg">
          <h3 className="type-card-title">{tAnalytics('outboundDestinations')}</h3>
          {snapshot.destinations?.length ? (
            <div className="mt-4">
              <AnalyticsBarChart
                data={snapshot.destinations.map((row) => ({
                  label: row.destination,
                  value: row.sessions,
                }))}
              />
            </div>
          ) : (
            <p className="mt-4 type-body-muted">
              {snapshot.destinations === null
                ? tAnalytics('sectionUnavailable')
                : tAnalytics('destinationsEmpty')}
            </p>
          )}
        </SurfaceCard>
      </div>
    </section>
  )
}
