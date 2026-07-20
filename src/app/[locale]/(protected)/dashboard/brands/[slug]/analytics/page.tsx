import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import type { OwnerAnalyticsSnapshotV1 } from '@/lib/analytics/posthog-types'
import { getPostHogOwnerAnalyticsSnapshot } from '@/lib/services/posthog-owner-analytics'
import { DataCard, SurfaceCard } from '@/components/ui/card'
import { BrandDashboardShell } from '@/components/dashboard/brand-dashboard-shell'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

type OwnerAnalyticsCopy = {
  profileSessions: string
  outboundSessions: string
  outboundConversion: string
  collectingBaseline: string
  priorChangeUnavailable: string
  currentRateUnavailable: string
  versusPrior: (change: string) => string
  conversionDefinition: string
  trendTitle: string
  trendDescription: string
  openPostHog: string
  trendAria: string
  trendUnavailable: string
  acquisitionTitle: string
  acquisitionUnavailable: string
  destinationsTitle: string
  destinationsUnavailable: string
  source: string
  dataThrough: string
  generated: string
  unavailableTitle: string
  unavailableBody: string
}

function comparisonDetail(
  current: number | null,
  prior: number | null,
  copy: OwnerAnalyticsCopy,
): string {
  if (current === null) return copy.currentRateUnavailable
  if (prior === null) return copy.collectingBaseline
  if (prior === 0) return copy.priorChangeUnavailable
  const change = ((current - prior) / prior) * 100
  return copy.versusPrior(`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`)
}

function OwnerAnalytics({
  snapshot,
  copy,
}: {
  snapshot: OwnerAnalyticsSnapshotV1
  copy: OwnerAnalyticsCopy
}) {
  const maxDaily = Math.max(
    ...(snapshot.daily ?? []).map((point) => point.profileSessions),
    1,
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DataCard
          tone="white"
          label={copy.profileSessions}
          value={snapshot.profileSessions.current}
          description={comparisonDetail(snapshot.profileSessions.current, snapshot.profileSessions.prior, copy)}
        />
        <DataCard
          tone="white"
          label={copy.outboundSessions}
          value={snapshot.outboundSessions.current}
          description={comparisonDetail(snapshot.outboundSessions.current, snapshot.outboundSessions.prior, copy)}
        />
        <DataCard
          tone="white"
          label={copy.outboundConversion}
          value={percent(snapshot.outboundConversion.current)}
          description={`${comparisonDetail(snapshot.outboundConversion.current, snapshot.outboundConversion.prior, copy)} · ${copy.conversionDefinition}`}
        />
      </div>

      <SurfaceCard padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="type-card-title">{copy.trendTitle}</h2>
            <p className="type-card-description">{copy.trendDescription}</p>
          </div>
          <a
            className="type-link"
            href={snapshot.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.openPostHog}
          </a>
        </div>
        {snapshot.daily ? (
          <figure className="mt-6" aria-label={copy.trendAria}>
            <div className="flex h-40 items-end gap-1" aria-hidden="true">
              {snapshot.daily.map((point) => (
                <span
                  key={point.date}
                  className="min-w-1 flex-1 rounded-t-sm bg-primary"
                  style={{ height: `${Math.max((point.profileSessions / maxDaily) * 100, 2)}%` }}
                  title={`${point.date}: ${point.profileSessions} profile, ${point.outboundSessions} outbound sessions`}
                />
              ))}
            </div>
            <figcaption className="mt-2 type-caption">
              {snapshot.windows.trend.startDate} – {snapshot.windows.trend.endDate} · Asia/Taipei
            </figcaption>
          </figure>
        ) : (
          <p className="mt-6 type-card-description">{copy.trendUnavailable}</p>
        )}
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SurfaceCard padding="lg">
          <h2 className="type-card-title">{copy.acquisitionTitle}</h2>
          {snapshot.acquisition ? (
            <ul className="mt-4 space-y-3">
              {snapshot.acquisition.map((row) => (
                <li className="flex justify-between gap-4" key={`${row.source}:${row.medium}`}>
                  <span>{row.source} · {row.medium}</span>
                  <strong>{row.sessions}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 type-card-description">{copy.acquisitionUnavailable}</p>}
        </SurfaceCard>

        <SurfaceCard padding="lg">
          <h2 className="type-card-title">{copy.destinationsTitle}</h2>
          {snapshot.destinations ? (
            <ul className="mt-4 space-y-3">
              {snapshot.destinations.map((row) => (
                <li className="flex justify-between gap-4" key={row.destination}>
                  <span>{row.destination}</span>
                  <strong>{row.sessions}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 type-card-description">{copy.destinationsUnavailable}</p>}
        </SurfaceCard>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 type-caption">
        <span>{copy.source} · PostHog</span>
        <span>{copy.dataThrough} · {snapshot.dataThrough}</span>
        <span>{copy.generated} · {new Date(snapshot.generatedAt).toLocaleString('en-GB', { timeZone: snapshot.timeZone })}</span>
      </div>
      {snapshot.completeness.warnings.length > 0 ? (
        <ul className="type-card-description">
          {snapshot.completeness.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

export default async function AnalyticsPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const editor = await requireBrandEditor(slug)
  if ('error' in editor) {
    redirect(editor.error === 'notLoggedIn' ? '/auth/sign-in' : localizePath('/dashboard', locale))
    return null
  }

  const t = await getTranslations({ locale, namespace: 'dashboard.analytics' })
  const copy: OwnerAnalyticsCopy = {
    profileSessions: t('profileSessions'),
    outboundSessions: t('outboundSessions'),
    outboundConversion: t('outboundConversion'),
    collectingBaseline: t('collectingBaseline'),
    priorChangeUnavailable: t('priorChangeUnavailable'),
    currentRateUnavailable: t('currentRateUnavailable'),
    versusPrior: (change) => t('versusPrior', { change }),
    conversionDefinition: t('conversionDefinition'),
    trendTitle: t('sessionTrend'),
    trendDescription: t('sessionTrendDescription'),
    openPostHog: t('openPostHog'),
    trendAria: t('sessionTrendAria'),
    trendUnavailable: t('trendUnavailable'),
    acquisitionTitle: t('acquisitionSources'),
    acquisitionUnavailable: t('acquisitionUnavailable'),
    destinationsTitle: t('outboundDestinations'),
    destinationsUnavailable: t('destinationsUnavailable'),
    source: t('source'),
    dataThrough: t('dataThrough'),
    generated: t('generated'),
    unavailableTitle: t('unavailableTitle'),
    unavailableBody: t('unavailableBody'),
  }

  let snapshot: OwnerAnalyticsSnapshotV1 | null = null
  try {
    snapshot = await getPostHogOwnerAnalyticsSnapshot(editor.brand.id)
  } catch {
    // The owner remains authorized; show a provider-specific unavailable state.
  }

  return (
    <BrandDashboardShell brandName={editor.brand.name} brandSlug={editor.brand.slug}>
      {snapshot ? (
        <OwnerAnalytics snapshot={snapshot} copy={copy} />
      ) : (
        <SurfaceCard padding="lg">
          <h2 className="type-card-title">{copy.unavailableTitle}</h2>
          <p className="mt-2 type-card-description">{copy.unavailableBody}</p>
        </SurfaceCard>
      )}
    </BrandDashboardShell>
  )
}
