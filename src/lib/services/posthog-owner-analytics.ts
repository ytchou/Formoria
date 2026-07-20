import {
  PostHogQueryError,
  createPostHogQueryClient,
  type PostHogQueryClient,
  type PostHogQueryResult,
} from '@/lib/adapters/posthog/query-api'
import type {
  AcquisitionRow,
  Comparison,
  DateWindow,
  DestinationRow,
  OwnerAnalyticsSnapshotV1,
  OwnerDailyPoint,
  RateComparison,
} from '@/lib/analytics/posthog-types'
import { getAnalyticsDateWindows } from './posthog-analytics'

const TIME_ZONE = 'Asia/Taipei' as const
const CACHE_TTL_MS = 15 * 60_000
const SESSION_ID = 'properties.$session_id'
const PUBLIC_EVENT = `properties.surface = 'public' AND properties.analytics_schema_version = 1`
const ownerCache = new Map<string, { expiresAt: number; value: OwnerAnalyticsSnapshotV1 }>()

function taipeiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function escapeHogQlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function dateCondition(window: DateWindow): string {
  return `toDate(toTimeZone(timestamp, '${TIME_ZONE}')) BETWEEN toDate('${window.startDate}') AND toDate('${window.endDate}')`
}

function profileSessions(window: DateWindow, brandId: string): string {
  return `SELECT DISTINCT ${SESSION_ID} FROM events WHERE event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND properties.brand_id = '${escapeHogQlString(brandId)}' AND ${dateCondition(window)}`
}

function coreQuery(brandId: string, current: DateWindow, prior: DateWindow): string {
  const safeBrandId = escapeHogQlString(brandId)
  return `
SELECT
  (SELECT toString(minOrNull(toDate(toTimeZone(timestamp, '${TIME_ZONE}')))) FROM events WHERE event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND properties.brand_id = '${safeBrandId}') AS available_from,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND properties.brand_id = '${safeBrandId}' AND ${dateCondition(current)}) AS current_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND properties.brand_id = '${safeBrandId}' AND ${dateCondition(prior)}) AS prior_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND properties.brand_id = '${safeBrandId}' AND ${dateCondition(current)} AND ${SESSION_ID} IN (${profileSessions(current, brandId)})) AS current_outbound_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND properties.brand_id = '${safeBrandId}' AND ${dateCondition(prior)} AND ${SESSION_ID} IN (${profileSessions(prior, brandId)})) AS prior_outbound_sessions
FROM events
WHERE ${PUBLIC_EVENT} AND ${dateCondition({ startDate: prior.startDate, endDate: current.endDate })}
`.trim()
}

function dailyQuery(brandId: string, window: DateWindow): string {
  const safeBrandId = escapeHogQlString(brandId)
  return `
SELECT
  toString(toDate(toTimeZone(timestamp, '${TIME_ZONE}'))) AS date,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND properties.brand_id = '${safeBrandId}') AS profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND properties.brand_id = '${safeBrandId}' AND ${SESSION_ID} IN (${profileSessions(window, brandId)})) AS outbound_sessions
FROM events
WHERE ${PUBLIC_EVENT} AND ${dateCondition(window)}
GROUP BY date
ORDER BY date
`.trim()
}

function acquisitionQuery(brandId: string, window: DateWindow): string {
  return `
SELECT source, medium, count() AS sessions
FROM (
  SELECT
    ${SESSION_ID} AS session_id,
    if(notEmpty(argMin(properties.$utm_source, timestamp)), argMin(properties.$utm_source, timestamp), if(notEmpty(argMin(properties.$referring_domain, timestamp)), argMin(properties.$referring_domain, timestamp), 'Direct')) AS source,
    if(notEmpty(argMin(properties.$utm_medium, timestamp)), argMin(properties.$utm_medium, timestamp), if(notEmpty(argMin(properties.$referring_domain, timestamp)), 'referral', 'direct')) AS medium
  FROM events
  WHERE event = '$pageview' AND ${PUBLIC_EVENT} AND ${SESSION_ID} IN (${profileSessions(window, brandId)})
  GROUP BY session_id
)
GROUP BY source, medium
ORDER BY sessions DESC
LIMIT 20
`.trim()
}

function destinationsQuery(brandId: string, window: DateWindow): string {
  return `
SELECT properties.link_type AS destination, uniq(${SESSION_ID}) AS sessions
FROM events
WHERE event = 'external_link_clicked'
  AND ${PUBLIC_EVENT}
  AND properties.brand_id = '${escapeHogQlString(brandId)}'
  AND ${dateCondition(window)}
  AND ${SESSION_ID} IN (${profileSessions(window, brandId)})
GROUP BY destination
ORDER BY sessions DESC
`.trim()
}

function invalidResponse(): never {
  throw new PostHogQueryError(
    'invalid_provider_response',
    'PostHog returned an invalid owner analytics response.',
  )
}

function rows(result: PostHogQueryResult): Array<Record<string, unknown>> {
  return result.results.map((row) => {
    if (row.length !== result.columns.length) invalidResponse()
    return Object.fromEntries(result.columns.map((column, index) => [column, row[index]]))
  })
}

function count(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key])
  if (!Number.isFinite(value) || value < 0) invalidResponse()
  return value
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || !value) invalidResponse()
  return value
}

function comparison(current: number, prior: number, ready: boolean): Comparison {
  return { current, prior: ready ? prior : null }
}

function conversion(
  currentOutbound: number,
  currentProfiles: number,
  priorOutbound: number,
  priorProfiles: number,
  ready: boolean,
): RateComparison {
  return {
    current: currentProfiles === 0 ? null : currentOutbound / currentProfiles,
    prior: ready && priorProfiles > 0 ? priorOutbound / priorProfiles : null,
  }
}

function parseCore(result: PostHogQueryResult, prior: DateWindow) {
  const resultRows = rows(result)
  if (resultRows.length !== 1) invalidResponse()
  const row = resultRows[0]
  const availableFrom = typeof row.available_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.available_from)
    ? row.available_from
    : null
  return {
    availableFrom,
    comparisonReady: availableFrom !== null && availableFrom < prior.startDate,
    currentProfiles: count(row, 'current_profile_sessions'),
    priorProfiles: count(row, 'prior_profile_sessions'),
    currentOutbound: count(row, 'current_outbound_sessions'),
    priorOutbound: count(row, 'prior_outbound_sessions'),
  }
}

function parseDaily(result: PostHogQueryResult, window: DateWindow): OwnerDailyPoint[] {
  const byDate = new Map(rows(result).map((row) => {
    const date = text(row, 'date')
    return [date, {
      date,
      profileSessions: count(row, 'profile_sessions'),
      outboundSessions: count(row, 'outbound_sessions'),
    } satisfies OwnerDailyPoint] as const
  }))
  const daily: OwnerDailyPoint[] = []
  for (let date = window.startDate; date <= window.endDate; date = shiftIsoDate(date, 1)) {
    daily.push(byDate.get(date) ?? { date, profileSessions: 0, outboundSessions: 0 })
  }
  return daily
}

function parseAcquisition(result: PostHogQueryResult): AcquisitionRow[] {
  return rows(result).map((row) => ({
    source: text(row, 'source'),
    medium: text(row, 'medium'),
    sessions: count(row, 'sessions'),
  }))
}

function parseDestinations(result: PostHogQueryResult): DestinationRow[] {
  return rows(result).map((row) => ({
    destination: text(row, 'destination'),
    sessions: count(row, 'sessions'),
  }))
}

function configuredSourceUrl(sourceUrl?: string): string {
  const value = sourceUrl ?? process.env.POSTHOG_DASHBOARD_URL?.trim()
  if (!value) {
    throw new PostHogQueryError('posthog_unconfigured', 'PostHog dashboard URL is not configured.')
  }
  try {
    const url = new URL(value)
    if (url.origin !== 'https://us.posthog.com') throw new Error('invalid host')
    return url.toString()
  } catch {
    throw new PostHogQueryError('posthog_unconfigured', 'PostHog dashboard URL is invalid.')
  }
}

export async function getPostHogOwnerAnalyticsSnapshot(
  brandId: string,
  {
    queryClient = createPostHogQueryClient(),
    now = () => new Date(),
    sourceUrl,
    cache = true,
  }: {
    queryClient?: PostHogQueryClient
    now?: () => Date
    sourceUrl?: string
    cache?: boolean
  } = {},
): Promise<OwnerAnalyticsSnapshotV1> {
  const generatedAt = now()
  const windows = getAnalyticsDateWindows(taipeiDate(generatedAt), 30, 30)
  const resolvedSourceUrl = configuredSourceUrl(sourceUrl)
  const cacheKey = `${brandId}:${windows.current.endDate}:${resolvedSourceUrl}`
  const cached = ownerCache.get(cacheKey)
  if (cache && cached && cached.expiresAt > generatedAt.getTime()) return cached.value

  const [coreResult, dailyResult, acquisitionResult, destinationResult] = await Promise.allSettled([
    queryClient.run('owner core totals', coreQuery(brandId, windows.current, windows.prior)),
    queryClient.run('owner daily trend', dailyQuery(brandId, windows.trend)),
    queryClient.run('owner acquisition', acquisitionQuery(brandId, windows.current)),
    queryClient.run('owner destinations', destinationsQuery(brandId, windows.current)),
  ])
  if (coreResult.status === 'rejected') throw coreResult.reason

  const core = parseCore(coreResult.value, windows.prior)
  const warnings: string[] = []
  let daily: OwnerDailyPoint[] | null = null
  let acquisition: AcquisitionRow[] | null = null
  let destinations: DestinationRow[] | null = null

  try {
    if (dailyResult.status === 'rejected') throw dailyResult.reason
    daily = parseDaily(dailyResult.value, windows.trend)
  } catch {
    warnings.push('Daily trend is temporarily unavailable.')
  }
  try {
    if (acquisitionResult.status === 'rejected') throw acquisitionResult.reason
    acquisition = parseAcquisition(acquisitionResult.value)
  } catch {
    warnings.push('Acquisition breakdown is temporarily unavailable.')
  }
  try {
    if (destinationResult.status === 'rejected') throw destinationResult.reason
    destinations = parseDestinations(destinationResult.value)
  } catch {
    warnings.push('Destination breakdown is temporarily unavailable.')
  }

  const snapshot: OwnerAnalyticsSnapshotV1 = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    dataThrough: windows.current.endDate,
    timeZone: TIME_ZONE,
    windows,
    profileSessions: comparison(core.currentProfiles, core.priorProfiles, core.comparisonReady),
    outboundSessions: comparison(core.currentOutbound, core.priorOutbound, core.comparisonReady),
    outboundConversion: conversion(
      core.currentOutbound,
      core.currentProfiles,
      core.priorOutbound,
      core.priorProfiles,
      core.comparisonReady,
    ),
    daily,
    acquisition,
    destinations,
    completeness: {
      comparisonReady: core.comparisonReady,
      availableFrom: core.availableFrom,
      warnings,
    },
    sourceUrl: resolvedSourceUrl,
  }

  if (cache && warnings.length === 0) {
    ownerCache.set(cacheKey, {
      expiresAt: generatedAt.getTime() + CACHE_TTL_MS,
      value: snapshot,
    })
  }
  return snapshot
}
