import {
  PostHogQueryError,
  createPostHogEndpointClient,
  type PostHogQueryResult,
} from '@/lib/adapters/posthog/query-api'
import {
  OWNER_ENDPOINTS,
  OWNER_ENDPOINTS_V2,
  type OwnerEndpointDef,
} from '@/lib/analytics/posthog-queries'
import type {
  Comparison,
  DateWindow,
  DestinationRow,
  OwnerAnalyticsSnapshotV1,
  OwnerDailyPoint,
  RateComparison,
  TrafficSourceRow,
} from '@/lib/analytics/posthog-types'
import { getAnalyticsDateWindows } from './posthog-analytics'

const TIME_ZONE = 'Asia/Taipei' as const

type PostHogEndpointClient = ReturnType<typeof createPostHogEndpointClient>

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

function invalidResponse(): never {
  throw new PostHogQueryError(
    'invalid_provider_response',
    'PostHog returned an invalid owner analytics response.',
  )
}

function endpointRows(result: PostHogQueryResult, columnCount: number): unknown[][] {
  if (result.results.some((row) => row.length !== columnCount)) invalidResponse()
  return result.results
}

function count(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) invalidResponse()
  return parsed
}

function text(value: unknown): string {
  if (typeof value !== 'string') invalidResponse()
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
  const resultRows = endpointRows(result, 5)
  if (resultRows.length !== 1) invalidResponse()
  const row = resultRows.at(0)
  if (!row) invalidResponse()
  const availableFrom = typeof row[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[0])
    ? row[0]
    : null

  return {
    availableFrom,
    comparisonReady: availableFrom !== null && availableFrom < prior.startDate,
    currentProfiles: count(row[1]),
    priorProfiles: count(row[2]),
    currentOutbound: count(row[3]),
    priorOutbound: count(row[4]),
  }
}

function parseDaily(result: PostHogQueryResult, window: DateWindow): OwnerDailyPoint[] {
  const byDate = new Map(endpointRows(result, 3).map((row) => {
    const date = text(row[0])
    return [date, {
      date,
      profileSessions: count(row[1]),
      outboundSessions: count(row[2]),
    } satisfies OwnerDailyPoint] as const
  }))
  const daily: OwnerDailyPoint[] = []

  for (let date = window.startDate; date <= window.endDate; date = shiftIsoDate(date, 1)) {
    daily.push(byDate.get(date) ?? { date, profileSessions: 0, outboundSessions: 0 })
  }
  return daily
}

function parseTrafficSources(result: PostHogQueryResult): TrafficSourceRow[] {
  return endpointRows(result, 2).map((row) => ({
    source: text(row[0]),
    sessions: count(row[1]),
  }))
}

function parseDestinations(result: PostHogQueryResult): DestinationRow[] {
  return endpointRows(result, 2).map((row) => ({
    destination: text(row[0]),
    sessions: count(row[1]),
  }))
}

function deriveTopTrafficSource(
  trafficSources: TrafficSourceRow[] | null,
): OwnerAnalyticsSnapshotV1['topTrafficSource'] {
  if (!trafficSources) return null
  const total = trafficSources.reduce((sum, row) => sum + row.sessions, 0)
  if (total === 0) return null
  const top = trafficSources.reduce<TrafficSourceRow | null>(
    (current, row) => !current || row.sessions > current.sessions ? row : current,
    null,
  )
  return top ? { source: top.source, share: top.sessions / total } : null
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function endpointWarning(error: unknown, unavailable: string): string {
  return errorCode(error) === 'endpoint_missing'
    ? 'The required PostHog analytics endpoint is missing.'
    : unavailable
}

function runEndpoint(
  client: PostHogEndpointClient,
  definition: OwnerEndpointDef,
  brandId: string,
  extraVariables?: Record<string, string>,
): Promise<PostHogQueryResult> {
  return client.runEndpoint(definition.name, definition.version, {
    brand_id: brandId,
    ...extraVariables,
  })
}

export async function getPostHogOwnerAnalyticsSnapshot(
  brandId: string,
  {
    client = createPostHogEndpointClient(),
    now = () => new Date(),
    daysBack = 30,
  }: {
    client?: PostHogEndpointClient
    now?: () => Date
    daysBack?: 7 | 30 | 90
  } = {},
): Promise<OwnerAnalyticsSnapshotV1> {
  const generatedAt = now()
  const windows = getAnalyticsDateWindows(taipeiDate(generatedAt), daysBack, daysBack)
  const endpoints = daysBack === 30 ? OWNER_ENDPOINTS : OWNER_ENDPOINTS_V2
  const dateVariables = daysBack === 30
    ? undefined
    : {
        current_start: windows.current.startDate,
        current_end: windows.current.endDate,
        prior_start: windows.prior.startDate,
        prior_end: windows.prior.endDate,
      }
  const [coreResult, dailyResult, trafficSourcesResult, destinationsResult] = await Promise.allSettled([
    runEndpoint(client, endpoints.brand_core_totals, brandId, dateVariables),
    runEndpoint(client, endpoints.brand_daily_trend, brandId, dateVariables),
    runEndpoint(client, endpoints.brand_traffic_sources, brandId, dateVariables),
    runEndpoint(client, endpoints.brand_outbound_destinations, brandId, dateVariables),
  ])

  let profileSessions: Comparison | null = null
  let outboundSessions: Comparison | null = null
  let outboundConversion: RateComparison | null = null
  let comparisonReady = false
  let availableFrom: string | null = null
  let daily: OwnerDailyPoint[] | null = null
  let trafficSources: TrafficSourceRow[] | null = null
  let destinations: DestinationRow[] | null = null
  const warnings: string[] = []

  try {
    if (coreResult.status === 'rejected') throw coreResult.reason
    const core = parseCore(coreResult.value, windows.prior)
    profileSessions = comparison(core.currentProfiles, core.priorProfiles, core.comparisonReady)
    outboundSessions = comparison(core.currentOutbound, core.priorOutbound, core.comparisonReady)
    outboundConversion = conversion(
      core.currentOutbound,
      core.currentProfiles,
      core.priorOutbound,
      core.priorProfiles,
      core.comparisonReady,
    )
    comparisonReady = core.comparisonReady
    availableFrom = core.availableFrom
  } catch (error) {
    warnings.push(endpointWarning(error, 'Core session metrics are temporarily unavailable.'))
  }

  try {
    if (dailyResult.status === 'rejected') throw dailyResult.reason
    daily = parseDaily(dailyResult.value, windows.trend)
  } catch (error) {
    warnings.push(endpointWarning(error, 'Daily trend is temporarily unavailable.'))
  }

  try {
    if (trafficSourcesResult.status === 'rejected') throw trafficSourcesResult.reason
    trafficSources = parseTrafficSources(trafficSourcesResult.value)
  } catch (error) {
    warnings.push(endpointWarning(error, 'Traffic sources are temporarily unavailable.'))
  }

  try {
    if (destinationsResult.status === 'rejected') throw destinationsResult.reason
    destinations = parseDestinations(destinationsResult.value)
  } catch (error) {
    warnings.push(endpointWarning(error, 'Destination breakdown is temporarily unavailable.'))
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    dataThrough: windows.current.endDate,
    timeZone: TIME_ZONE,
    windows,
    profileSessions,
    outboundSessions,
    outboundConversion,
    daily,
    trafficSources,
    topTrafficSource: deriveTopTrafficSource(trafficSources),
    destinations,
    completeness: {
      comparisonReady,
      availableFrom,
      warnings,
    },
  }
}
