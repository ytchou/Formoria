import {
  PostHogQueryError,
  createPostHogQueryClient,
  type PostHogQueryClient,
  type PostHogQueryResult,
} from '@/lib/adapters/posthog/query-api'
import type {
  AcquisitionRow,
  AnalyticsSnapshotV1,
  Comparison,
  DailyPoint,
  DateWindow,
  RateComparison,
  TopBrandRow,
} from '@/lib/analytics/posthog-types'
import { createServiceClient } from '@/lib/supabase/server'

const TIME_ZONE = 'Asia/Taipei' as const
const CACHE_TTL_MS = 15 * 60_000

type BrandIdentity = { id: string; name: string; slug: string }
type HydrateBrands = (brandIds: string[]) => Promise<BrandIdentity[]>

const snapshotCache = new Map<string, { expiresAt: number; value: AnalyticsSnapshotV1 }>()

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function taipeiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function getAnalyticsDateWindows(
  today: string,
  currentDays = 7,
  trendDays = 28,
): { current: DateWindow; prior: DateWindow; trend: DateWindow } {
  return {
    current: {
      startDate: shiftIsoDate(today, -currentDays),
      endDate: shiftIsoDate(today, -1),
    },
    prior: {
      startDate: shiftIsoDate(today, -(currentDays * 2)),
      endDate: shiftIsoDate(today, -(currentDays + 1)),
    },
    trend: {
      startDate: shiftIsoDate(today, -trendDays),
      endDate: shiftIsoDate(today, -1),
    },
  }
}

function dateCondition(window: DateWindow): string {
  return `toDate(toTimeZone(timestamp, '${TIME_ZONE}')) BETWEEN toDate('${window.startDate}') AND toDate('${window.endDate}')`
}

const PUBLIC_EVENT = `properties.surface = 'public' AND properties.analytics_schema_version = 1`
const SESSION_ID = 'properties.$session_id'

function profileSessionsSubquery(window: DateWindow, brandId?: string): string {
  const brandFilter = brandId ? ` AND properties.brand_id = '${escapeHogQlString(brandId)}'` : ''
  return `SELECT DISTINCT ${SESSION_ID} FROM events WHERE event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND ${dateCondition(window)}${brandFilter}`
}

function publicSessionsSubquery(window: DateWindow): string {
  return `SELECT DISTINCT ${SESSION_ID} FROM events WHERE event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(window)}`
}

function escapeHogQlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function coreQuery(windows: ReturnType<typeof getAnalyticsDateWindows>): string {
  const currentProfileSessions = profileSessionsSubquery(windows.current)
  const priorProfileSessions = profileSessionsSubquery(windows.prior)
  return `
SELECT
  (SELECT toString(minOrNull(toDate(toTimeZone(timestamp, '${TIME_ZONE}')))) FROM events WHERE event = '$pageview' AND ${PUBLIC_EVENT}) AS available_from,
  uniqIf(distinct_id, event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.current)}) AS current_unique_visitors,
  uniqIf(distinct_id, event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.prior)}) AS prior_unique_visitors,
  uniqIf(${SESSION_ID}, event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.current)}) AS current_public_sessions,
  uniqIf(${SESSION_ID}, event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.prior)}) AS prior_public_sessions,
  countIf(event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.current)}) AS current_pageviews,
  countIf(event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.prior)}) AS prior_pageviews,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.current)}) AS current_brand_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.prior)}) AS prior_brand_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.current)} AND ${SESSION_ID} IN (${currentProfileSessions})) AS current_outbound_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND ${PUBLIC_EVENT} AND ${dateCondition(windows.prior)} AND ${SESSION_ID} IN (${priorProfileSessions})) AS prior_outbound_sessions
FROM events
WHERE ${dateCondition({ startDate: windows.prior.startDate, endDate: windows.current.endDate })}
`.trim()
}

function dailyQuery(window: DateWindow): string {
  return `
SELECT
  toString(toDate(toTimeZone(timestamp, '${TIME_ZONE}'))) AS date,
  uniqIf(distinct_id, event = '$pageview' AND ${PUBLIC_EVENT}) AS unique_visitors,
  uniqIf(${SESSION_ID}, event = '$pageview' AND ${PUBLIC_EVENT}) AS public_sessions,
  countIf(event = '$pageview' AND ${PUBLIC_EVENT}) AS pageviews,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND ${PUBLIC_EVENT}) AS brand_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND ${PUBLIC_EVENT} AND ${SESSION_ID} IN (${profileSessionsSubquery(window)})) AS outbound_sessions
FROM events
WHERE ${dateCondition(window)}
GROUP BY date
ORDER BY date
`.trim()
}

function acquisitionQuery(window: DateWindow): string {
  const pageviewWindow = {
    startDate: shiftIsoDate(window.startDate, -1),
    endDate: window.endDate,
  }
  return `
SELECT source, medium, count() AS sessions
FROM (
  SELECT
    ${SESSION_ID} AS session_id,
    if(notEmpty(argMin(coalesce(properties.$utm_source, ''), timestamp)), argMin(coalesce(properties.$utm_source, ''), timestamp), if(notEmpty(argMin(coalesce(properties.$referring_domain, ''), timestamp)), argMin(coalesce(properties.$referring_domain, ''), timestamp), 'Direct')) AS source,
    if(notEmpty(argMin(coalesce(properties.$utm_medium, ''), timestamp)), argMin(coalesce(properties.$utm_medium, ''), timestamp), if(notEmpty(argMin(coalesce(properties.$referring_domain, ''), timestamp)), 'referral', 'direct')) AS medium
  FROM events
  WHERE event = '$pageview' AND ${PUBLIC_EVENT} AND ${dateCondition(pageviewWindow)} AND ${SESSION_ID} IN (${publicSessionsSubquery(window)})
  GROUP BY session_id
)
GROUP BY source, medium
ORDER BY sessions DESC
LIMIT 20
`.trim()
}

function topBrandsQuery(window: DateWindow): string {
  return `
SELECT
  properties.brand_id AS brand_id,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed') AS brand_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND ${SESSION_ID} IN (${profileSessionsSubquery(window)})) AS outbound_sessions
FROM events
WHERE ${PUBLIC_EVENT} AND ${dateCondition(window)} AND event IN ('brand_detail_viewed', 'external_link_clicked') AND notEmpty(properties.brand_id)
GROUP BY brand_id
ORDER BY brand_profile_sessions DESC, outbound_sessions DESC
LIMIT 10
`.trim()
}

function rowObjects(result: PostHogQueryResult): Array<Record<string, unknown>> {
  return result.results.map((row) => {
    if (row.length !== result.columns.length) invalidResponse()
    return Object.fromEntries(result.columns.map((column, index) => [column, row[index]]))
  })
}

function invalidResponse(): never {
  throw new PostHogQueryError(
    'invalid_provider_response',
    'PostHog returned an invalid analytics response.',
  )
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

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function rateComparison(
  currentNumerator: number,
  currentDenominator: number,
  priorNumerator: number,
  priorDenominator: number,
  ready: boolean,
): RateComparison {
  return {
    current: rate(currentNumerator, currentDenominator),
    prior: ready ? rate(priorNumerator, priorDenominator) : null,
  }
}

function parseCore(result: PostHogQueryResult, priorWindow: DateWindow) {
  const rows = rowObjects(result)
  if (rows.length !== 1) invalidResponse()
  const row = rows[0]
  const rawAvailableFrom = row.available_from
  const availableFrom = typeof rawAvailableFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawAvailableFrom)
    ? rawAvailableFrom
    : null
  const comparisonReady = availableFrom !== null && availableFrom < priorWindow.startDate

  return {
    availableFrom,
    comparisonReady,
    currentUniqueVisitors: count(row, 'current_unique_visitors'),
    priorUniqueVisitors: count(row, 'prior_unique_visitors'),
    currentPublicSessions: count(row, 'current_public_sessions'),
    priorPublicSessions: count(row, 'prior_public_sessions'),
    currentPageviews: count(row, 'current_pageviews'),
    priorPageviews: count(row, 'prior_pageviews'),
    currentBrandProfileSessions: count(row, 'current_brand_profile_sessions'),
    priorBrandProfileSessions: count(row, 'prior_brand_profile_sessions'),
    currentOutboundSessions: count(row, 'current_outbound_sessions'),
    priorOutboundSessions: count(row, 'prior_outbound_sessions'),
  }
}

function emptyDaily(date: string): DailyPoint {
  return {
    date,
    uniqueVisitors: 0,
    publicSessions: 0,
    pageviews: 0,
    brandProfileSessions: 0,
    outboundSessions: 0,
  }
}

function parseDaily(result: PostHogQueryResult, window: DateWindow): DailyPoint[] {
  const points = new Map(rowObjects(result).map((row) => {
    const date = text(row, 'date')
    return [date, {
      date,
      uniqueVisitors: count(row, 'unique_visitors'),
      publicSessions: count(row, 'public_sessions'),
      pageviews: count(row, 'pageviews'),
      brandProfileSessions: count(row, 'brand_profile_sessions'),
      outboundSessions: count(row, 'outbound_sessions'),
    } satisfies DailyPoint] as const
  }))

  const daily: DailyPoint[] = []
  for (let date = window.startDate; date <= window.endDate; date = shiftIsoDate(date, 1)) {
    daily.push(points.get(date) ?? emptyDaily(date))
  }
  return daily
}

function parseAcquisition(result: PostHogQueryResult): AcquisitionRow[] {
  return rowObjects(result).map((row) => ({
    source: text(row, 'source'),
    medium: text(row, 'medium'),
    sessions: count(row, 'sessions'),
  }))
}

async function parseTopBrands(
  result: PostHogQueryResult,
  hydrateBrands: HydrateBrands,
): Promise<TopBrandRow[]> {
  const rows = rowObjects(result).map((row) => ({
    brandId: text(row, 'brand_id'),
    brandProfileSessions: count(row, 'brand_profile_sessions'),
    outboundSessions: count(row, 'outbound_sessions'),
  }))
  if (rows.length === 0) return []

  const identities = await hydrateBrands(rows.map((row) => row.brandId))
  const byId = new Map(identities.map((brand) => [brand.id, brand]))
  return rows.flatMap((row) => {
    const brand = byId.get(row.brandId)
    return brand ? [{
      ...row,
      brandName: brand.name,
      brandSlug: brand.slug,
    }] : []
  })
}

async function defaultHydrateBrands(brandIds: string[]): Promise<BrandIdentity[]> {
  if (brandIds.length === 0) return []
  const { data, error } = await createServiceClient()
    .from('brands')
    .select('id, name, slug')
    .in('id', brandIds)
  if (error) throw new Error('Brand hydration failed')
  return data
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

export async function getPostHogAnalyticsSnapshot({
  queryClient = createPostHogQueryClient(),
  hydrateBrands = defaultHydrateBrands,
  now = () => new Date(),
  sourceUrl,
  cache = true,
}: {
  queryClient?: PostHogQueryClient
  hydrateBrands?: HydrateBrands
  now?: () => Date
  sourceUrl?: string
  cache?: boolean
} = {}): Promise<AnalyticsSnapshotV1> {
  const generatedAt = now()
  const today = taipeiDate(generatedAt)
  const windows = getAnalyticsDateWindows(today)
  const resolvedSourceUrl = configuredSourceUrl(sourceUrl)
  const cacheKey = `${windows.current.endDate}:${resolvedSourceUrl}`
  const cached = snapshotCache.get(cacheKey)
  if (cache && cached && cached.expiresAt > generatedAt.getTime()) return cached.value

  const [coreResult, dailyResult, acquisitionResult, topBrandsResult] = await Promise.allSettled([
    queryClient.run('personal os core totals', coreQuery(windows)),
    queryClient.run('personal os daily trend', dailyQuery(windows.trend)),
    queryClient.run('personal os acquisition', acquisitionQuery(windows.current)),
    queryClient.run('personal os top brands', topBrandsQuery(windows.current)),
  ])
  if (coreResult.status === 'rejected') throw coreResult.reason

  const core = parseCore(coreResult.value, windows.prior)
  const warnings: string[] = []

  let daily: DailyPoint[] | null = null
  if (dailyResult.status === 'fulfilled') {
    try {
      daily = parseDaily(dailyResult.value, windows.trend)
    } catch {
      warnings.push('Daily trend is temporarily unavailable.')
    }
  } else {
    warnings.push('Daily trend is temporarily unavailable.')
  }

  let acquisition: AcquisitionRow[] | null = null
  if (acquisitionResult.status === 'fulfilled') {
    try {
      acquisition = parseAcquisition(acquisitionResult.value)
    } catch {
      warnings.push('Acquisition breakdown is temporarily unavailable.')
    }
  } else {
    warnings.push('Acquisition breakdown is temporarily unavailable.')
  }

  let topBrands: TopBrandRow[] | null = null
  if (topBrandsResult.status === 'fulfilled') {
    try {
      topBrands = await parseTopBrands(topBrandsResult.value, hydrateBrands)
    } catch {
      warnings.push('Top brands breakdown is temporarily unavailable.')
    }
  } else {
    warnings.push('Top brands breakdown is temporarily unavailable.')
  }

  const snapshot: AnalyticsSnapshotV1 = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    dataThrough: windows.current.endDate,
    timeZone: TIME_ZONE,
    windows,
    audience: {
      uniqueVisitors: comparison(core.currentUniqueVisitors, core.priorUniqueVisitors, core.comparisonReady),
      publicSessions: comparison(core.currentPublicSessions, core.priorPublicSessions, core.comparisonReady),
      pageviews: comparison(core.currentPageviews, core.priorPageviews, core.comparisonReady),
    },
    discovery: {
      brandProfileSessions: comparison(core.currentBrandProfileSessions, core.priorBrandProfileSessions, core.comparisonReady),
      outboundSessions: comparison(core.currentOutboundSessions, core.priorOutboundSessions, core.comparisonReady),
      brandReachRate: rateComparison(
        core.currentBrandProfileSessions,
        core.currentPublicSessions,
        core.priorBrandProfileSessions,
        core.priorPublicSessions,
        core.comparisonReady,
      ),
      outboundConversion: rateComparison(
        core.currentOutboundSessions,
        core.currentBrandProfileSessions,
        core.priorOutboundSessions,
        core.priorBrandProfileSessions,
        core.comparisonReady,
      ),
    },
    daily,
    acquisition,
    topBrands,
    completeness: {
      comparisonReady: core.comparisonReady,
      availableFrom: core.availableFrom,
      warnings,
    },
    sourceUrl: resolvedSourceUrl,
  }

  if (cache && warnings.length === 0) {
    snapshotCache.set(cacheKey, {
      expiresAt: generatedAt.getTime() + CACHE_TTL_MS,
      value: snapshot,
    })
  }
  return snapshot
}
