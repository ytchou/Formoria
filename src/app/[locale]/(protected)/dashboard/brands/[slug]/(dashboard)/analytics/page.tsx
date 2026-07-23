import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { OwnerAnalyticsSnapshotV1 } from '@/lib/analytics/posthog-types'
import {
  countDelta,
  percent,
  rateDelta,
} from '@/lib/analytics/delta-formatters'
import { trafficSourceLabel } from '@/lib/analytics/traffic-source-labels'
import { getBrandBySlug } from '@/lib/services/brands'
import { getPostHogOwnerAnalyticsSnapshot as getOwnerAnalyticsSnapshot } from '@/lib/services/posthog-owner-analytics'
import { AnalyticsDonutCard } from '@/components/dashboard/analytics-donut-card'
import { AnalyticsTrendChart } from '@/components/dashboard/analytics-trend-chart'
import { DataCard, SurfaceCard } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

type OwnerAnalyticsCopy = {
  profileVisits: string
  outboundClicks: string
  outboundClickRate: string
  topTrafficSource: string
  shareOfVisits: (share: number) => string
  tooltipProfileVisits: string
  tooltipOutboundClicks: string
  tooltipOutboundClickRate: string
  tooltipTopTrafficSource: string
  collectingBaseline: string
  currentRateUnavailable: string
  trendTitle: string
  trendAria: string
  trendUnavailable: string
  trendEmpty: string
  trafficSources: string
  trafficSourceSearch: string
  trafficSourceCategory: string
  trafficSourceHomepage: string
  trafficSourceDirect: string
  trafficSourceOther: string
  trafficSourcesEmpty: string
  outboundDestinations: string
  destinationsEmpty: string
  sectionUnavailable: string
  nudgeTitle: string
  nudgeBody: string
  dataThrough: string
  unavailableTitle: string
  unavailableBody: string
}

function comparisonDescription(
  current: number | null,
  prior: number | null,
  copy: OwnerAnalyticsCopy,
): string | undefined {
  if (current === null) return copy.currentRateUnavailable
  if (prior === null || prior === 0) return copy.collectingBaseline
  return undefined
}

function KpiLabel({ definition, label }: { definition: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger
          aria-label="definition"
          className="flex min-h-12 min-w-12 items-center justify-center rounded-md text-muted-foreground"
          type="button"
        >
          ⓘ
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{definition}</TooltipContent>
      </Tooltip>
    </span>
  )
}

function OwnerAnalytics({
  snapshot,
  copy,
}: {
  snapshot: OwnerAnalyticsSnapshotV1
  copy: OwnerAnalyticsCopy
}) {
  const hasDailySessions = snapshot.daily?.some(
    (point) => point.profileSessions > 0 || point.outboundSessions > 0,
  ) ?? false
  const topSource = snapshot.topTrafficSource
  const trafficSourceLabels = {
    search: copy.trafficSourceSearch,
    category: copy.trafficSourceCategory,
    homepage: copy.trafficSourceHomepage,
    direct: copy.trafficSourceDirect,
    other: copy.trafficSourceOther,
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <DataCard
            tone="white"
            label={<KpiLabel definition={copy.tooltipProfileVisits} label={copy.profileVisits} />}
            value={snapshot.profileSessions?.current ?? '—'}
            delta={snapshot.profileSessions
              ? countDelta(snapshot.profileSessions.current, snapshot.profileSessions.prior)
              : undefined}
            description={snapshot.profileSessions
              ? comparisonDescription(
                  snapshot.profileSessions.current,
                  snapshot.profileSessions.prior,
                  copy,
                )
              : copy.currentRateUnavailable}
          />
          <DataCard
            tone="white"
            label={<KpiLabel definition={copy.tooltipOutboundClicks} label={copy.outboundClicks} />}
            value={snapshot.outboundSessions?.current ?? '—'}
            delta={snapshot.outboundSessions
              ? countDelta(snapshot.outboundSessions.current, snapshot.outboundSessions.prior)
              : undefined}
            description={snapshot.outboundSessions
              ? comparisonDescription(
                  snapshot.outboundSessions.current,
                  snapshot.outboundSessions.prior,
                  copy,
                )
              : copy.currentRateUnavailable}
          />
          <DataCard
            tone="white"
            label={(
              <KpiLabel
                definition={copy.tooltipOutboundClickRate}
                label={copy.outboundClickRate}
              />
            )}
            value={snapshot.outboundConversion
              ? percent(snapshot.outboundConversion.current)
              : '—'}
            delta={snapshot.outboundConversion
              ? rateDelta(
                  snapshot.outboundConversion.current,
                  snapshot.outboundConversion.prior,
                )
              : undefined}
            description={snapshot.outboundConversion
              ? comparisonDescription(
                  snapshot.outboundConversion.current,
                  snapshot.outboundConversion.prior,
                  copy,
                )
              : copy.currentRateUnavailable}
          />
          <DataCard
            tone="white"
            label={(
              <KpiLabel
                definition={copy.tooltipTopTrafficSource}
                label={copy.topTrafficSource}
              />
            )}
            value={topSource
              ? trafficSourceLabel(topSource.source, trafficSourceLabels)
              : '—'}
            description={topSource
              ? copy.shareOfVisits(Math.round(topSource.share * 100))
              : copy.sectionUnavailable}
          />
        </div>

        <SurfaceCard padding="lg">
          <h2 className="type-card-title">{copy.trendTitle}</h2>
          {snapshot.daily && hasDailySessions ? (
            <div className="mt-6">
              <AnalyticsTrendChart
                data={snapshot.daily.map((point) => ({
                  date: point.date,
                  profileSessions: point.profileSessions,
                  outboundSessions: point.outboundSessions,
                }))}
                labels={{
                  profile: copy.profileVisits,
                  outbound: copy.outboundClicks,
                  aria: copy.trendAria,
                }}
              />
            </div>
          ) : (
            <p className="mt-6 type-card-description">
              {snapshot.daily === null ? copy.trendUnavailable : copy.trendEmpty}
            </p>
          )}
        </SurfaceCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AnalyticsDonutCard
            title={copy.trafficSources}
            rows={(snapshot.trafficSources ?? []).map((row) => ({
              key: row.source,
              label: trafficSourceLabel(row.source, trafficSourceLabels),
              sessions: row.sessions,
            }))}
            emptyLabel={snapshot.trafficSources === null
              ? copy.sectionUnavailable
              : copy.trafficSourcesEmpty}
          />
          <AnalyticsDonutCard
            title={copy.outboundDestinations}
            rows={(snapshot.destinations ?? []).map((row) => ({
              key: row.destination,
              label: row.destination,
              sessions: row.sessions,
            }))}
            emptyLabel={snapshot.destinations === null
              ? copy.sectionUnavailable
              : copy.destinationsEmpty}
          />
        </div>

        <SurfaceCard tone="info" padding="lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="type-card-title">{copy.nudgeTitle}</h2>
              <p className="mt-2 type-card-description">{copy.nudgeBody}</p>
            </div>
            <p className="shrink-0 type-caption sm:text-right">
              {copy.dataThrough} · {snapshot.dataThrough}
            </p>
          </div>
        </SurfaceCard>
      </div>
    </TooltipProvider>
  )
}

export default async function AnalyticsPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const brand = await getBrandBySlug(slug)

  const t = await getTranslations({ locale, namespace: 'dashboard.analytics' })
  const copy: OwnerAnalyticsCopy = {
    profileVisits: t('profileVisits'),
    outboundClicks: t('outboundClicks'),
    outboundClickRate: t('outboundClickRate'),
    topTrafficSource: t('topTrafficSource'),
    shareOfVisits: (share) => t('shareOfVisits', { share }),
    tooltipProfileVisits: t('tooltipProfileVisits'),
    tooltipOutboundClicks: t('tooltipOutboundClicks'),
    tooltipOutboundClickRate: t('tooltipOutboundClickRate'),
    tooltipTopTrafficSource: t('tooltipTopTrafficSource'),
    collectingBaseline: t('collectingBaseline'),
    currentRateUnavailable: t('currentRateUnavailable'),
    trendTitle: t('trendTitle'),
    trendAria: t('trendAria'),
    trendUnavailable: t('trendUnavailable'),
    trendEmpty: t('trendEmpty'),
    trafficSources: t('trafficSources'),
    trafficSourceSearch: t('trafficSourceSearch'),
    trafficSourceCategory: t('trafficSourceCategory'),
    trafficSourceHomepage: t('trafficSourceHomepage'),
    trafficSourceDirect: t('trafficSourceDirect'),
    trafficSourceOther: t('trafficSourceOther'),
    trafficSourcesEmpty: t('trafficSourcesEmpty'),
    outboundDestinations: t('outboundDestinations'),
    destinationsEmpty: t('destinationsEmpty'),
    sectionUnavailable: t('sectionUnavailable'),
    nudgeTitle: t('nudgeTitle'),
    nudgeBody: t('nudgeBody'),
    dataThrough: t('dataThrough'),
    unavailableTitle: t('unavailableTitle'),
    unavailableBody: t('unavailableBody'),
  }

  let snapshot: OwnerAnalyticsSnapshotV1 | null = null
  try {
    snapshot = await getOwnerAnalyticsSnapshot(brand.id)
  } catch {
    // The owner remains authorized while analytics are temporarily unavailable.
  }

  return snapshot ? (
    <OwnerAnalytics snapshot={snapshot} copy={copy} />
  ) : (
    <SurfaceCard padding="lg">
      <h2 className="type-card-title">{copy.unavailableTitle}</h2>
      <p className="mt-2 type-card-description">{copy.unavailableBody}</p>
    </SurfaceCard>
  )
}
