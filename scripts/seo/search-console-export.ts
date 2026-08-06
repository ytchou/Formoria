import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importPKCS8, SignJWT } from 'jose'
import {
  classifyLandingPage,
  classifyQuery,
  QUERY_CLUSTERS,
  type LandingPageType,
  type QueryCluster,
} from '../../src/lib/seo/search-console/segmentation'

export type SearchConsoleQueryRow = {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type SearchConsolePageRow = {
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type ScorecardMetric = {
  impressions: number
  clicks: number
  ctr: number
}

export type QueryClusterScore = ScorecardMetric & {
  cluster: QueryCluster
  averagePosition: number
}

export type PositionBucket = '1-3' | '4-10' | '11-20' | '21-50' | '50+'

export type Scorecard = {
  nonBrand: ScorecardMetric
  branded: ScorecardMetric
  total: ScorecardMetric
  clusters: QueryClusterScore[]
  positionBuckets: Record<PositionBucket, number>
  landingPages: Array<{
    page: string
    impressions: number
    clicks: number
  }>
  pageTypes: Partial<Record<LandingPageType, ScorecardMetric>>
  l1Pages: Record<string, number>
  l2Pages: Record<string, number>
}

type MetricAccumulator = {
  impressions: number
  clicks: number
}

type ClusterAccumulator = MetricAccumulator & {
  weightedPositionTotal: number
  plainPositionTotal: number
  rowCount: number
}

type LandingPageTotal = {
  page: string
  impressions: number
  clicks: number
}

export const SEARCH_CONSOLE_CREDENTIALS_ENV = 'GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON'
export const SEARCH_CONSOLE_PROPERTY_ENV = 'GOOGLE_SEARCH_CONSOLE_PROPERTY'

export type SearchConsoleCredentials = {
  client_email: string
  private_key: string
  token_uri?: string
}

type SearchConsoleConfiguration = {
  credentials: SearchConsoleCredentials
  property: string
}

export class MissingSearchConsoleCredentialsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingSearchConsoleCredentialsError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function provisionInstructions(): string {
  return 'Provision it by: create a GCP service account, grant it read access to the Search Console property, and paste the JSON key into .env.local.'
}

export function assertSearchConsoleCredentials(
  env: Record<string, string | undefined> = process.env,
): SearchConsoleConfiguration {
  const rawCredentials = env[SEARCH_CONSOLE_CREDENTIALS_ENV]
  if (!rawCredentials) {
    throw new MissingSearchConsoleCredentialsError(
      `Missing ${SEARCH_CONSOLE_CREDENTIALS_ENV}. ${provisionInstructions()}`,
    )
  }

  const property = env[SEARCH_CONSOLE_PROPERTY_ENV]
  if (!property) {
    throw new MissingSearchConsoleCredentialsError(
      `Missing ${SEARCH_CONSOLE_PROPERTY_ENV}. ${provisionInstructions()}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawCredentials)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MissingSearchConsoleCredentialsError(
      `Invalid ${SEARCH_CONSOLE_CREDENTIALS_ENV}: ${reason}. ${provisionInstructions()}`,
    )
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.client_email !== 'string' ||
    typeof parsed.private_key !== 'string'
  ) {
    throw new MissingSearchConsoleCredentialsError(
      `Invalid ${SEARCH_CONSOLE_CREDENTIALS_ENV}: expected client_email and private_key. ${provisionInstructions()}`,
    )
  }

  return {
    credentials: {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(typeof parsed.token_uri === 'string' ? { token_uri: parsed.token_uri } : {}),
    },
    property,
  }
}

function metric({ impressions, clicks }: MetricAccumulator): ScorecardMetric {
  return {
    impressions,
    clicks,
    ctr: impressions === 0 ? 0 : clicks / impressions,
  }
}

function addMetric(target: MetricAccumulator, row: MetricAccumulator): void {
  target.impressions += row.impressions
  target.clicks += row.clicks
}

/**
 * Ordered, upper-bound-only bucket table: the first entry whose `max` is not
 * exceeded wins, so every position lands in exactly one bucket and the boundary
 * rule is expressed once. Bounds are inclusive at the top (1..3, 3<p<=10,
 * 10<p<=20, 20<p<=50). Upper bounds only matters because Search Console
 * positions are DECIMALS — a gapped table (min 1 max 3, then min 4) silently
 * drops position 3.5 into the overflow bucket.
 */
const POSITION_BUCKET_TABLE = [
  { label: '1-3', max: 3 },
  { label: '4-10', max: 10 },
  { label: '11-20', max: 20 },
  { label: '21-50', max: 50 },
] as const

function positionBucket(position: number): PositionBucket {
  if (!Number.isFinite(position)) return '50+'
  return POSITION_BUCKET_TABLE.find(({ max }) => position <= max)?.label ?? '50+'
}

function emptyPositionBuckets(): Record<PositionBucket, number> {
  return {
    '1-3': 0,
    '4-10': 0,
    '11-20': 0,
    '21-50': 0,
    '50+': 0,
  }
}

function emptyClusterAccumulator(): ClusterAccumulator {
  return {
    impressions: 0,
    clicks: 0,
    weightedPositionTotal: 0,
    plainPositionTotal: 0,
    rowCount: 0,
  }
}

export function buildScorecard(rows: {
  queries: SearchConsoleQueryRow[]
  pages: SearchConsolePageRow[]
}): Scorecard {
  const totalAccumulator: MetricAccumulator = { impressions: 0, clicks: 0 }
  const brandedAccumulator: MetricAccumulator = { impressions: 0, clicks: 0 }
  const nonBrandAccumulator: MetricAccumulator = { impressions: 0, clicks: 0 }
  const clusters = new Map<QueryCluster, ClusterAccumulator>()
  const positionBuckets = emptyPositionBuckets()

  for (const cluster of QUERY_CLUSTERS) clusters.set(cluster, emptyClusterAccumulator())

  for (const row of rows.queries) {
    addMetric(totalAccumulator, row)
    const classification = classifyQuery(row.query)
    const cluster = clusters.get(classification.cluster)

    if (cluster) {
      addMetric(cluster, row)
      cluster.weightedPositionTotal += row.position * row.impressions
      cluster.plainPositionTotal += row.position
      cluster.rowCount += 1
    }

    if (classification.cluster === 'branded') addMetric(brandedAccumulator, row)
    else addMetric(nonBrandAccumulator, row)

    const bucket = positionBucket(row.position)
    positionBuckets[bucket] += 1
  }

  const pageTotals = new Map<LandingPageType, MetricAccumulator>()
  const landingPageTotals = new Map<string, LandingPageTotal>()
  const l1PageImpressions = new Map<string, number>()
  const l2PageImpressions = new Map<string, number>()

  for (const row of rows.pages) {
    const classification = classifyLandingPage(row.page)
    const pageTypeTotal = pageTotals.get(classification.pageType) ?? { impressions: 0, clicks: 0 }
    addMetric(pageTypeTotal, row)
    pageTotals.set(classification.pageType, pageTypeTotal)

    const landingPageTotal = landingPageTotals.get(row.page) ?? {
      page: row.page,
      impressions: 0,
      clicks: 0,
    }
    landingPageTotal.impressions += row.impressions
    landingPageTotal.clicks += row.clicks
    landingPageTotals.set(row.page, landingPageTotal)

    if (classification.pageType === 'l1-category') {
      l1PageImpressions.set(
        row.page,
        (l1PageImpressions.get(row.page) ?? 0) + row.impressions,
      )
    }
    if (classification.pageType === 'l2-category') {
      l2PageImpressions.set(
        row.page,
        (l2PageImpressions.get(row.page) ?? 0) + row.impressions,
      )
    }
  }

  const clusterScores = QUERY_CLUSTERS.map((cluster): QueryClusterScore => {
    const aggregate = clusters.get(cluster) ?? emptyClusterAccumulator()
    // Average position is impression-weighted; when all impressions are zero, use a plain mean.
    const averagePosition =
      aggregate.impressions > 0
        ? aggregate.weightedPositionTotal / aggregate.impressions
        : aggregate.rowCount > 0
          ? aggregate.plainPositionTotal / aggregate.rowCount
          : 0

    return {
      cluster,
      ...metric(aggregate),
      averagePosition,
    }
  })

  const pageTypes: Partial<Record<LandingPageType, ScorecardMetric>> = {}
  for (const [pageType, aggregate] of pageTotals) pageTypes[pageType] = metric(aggregate)

  return {
    nonBrand: metric(nonBrandAccumulator),
    branded: metric(brandedAccumulator),
    total: metric(totalAccumulator),
    clusters: clusterScores,
    positionBuckets,
    landingPages: [...landingPageTotals.values()].sort(
      (left, right) =>
        right.impressions - left.impressions || left.page.localeCompare(right.page),
    ),
    pageTypes,
    l1Pages: Object.fromEntries(l1PageImpressions),
    l2Pages: Object.fromEntries(l2PageImpressions),
  }
}

export type SearchConsoleWindow = {
  label: string
  startDate: string
  endDate: string
}

// Search Console data can lag by several days; exclude the latest three days as incomplete.
export const SEARCH_CONSOLE_DATA_LAG_DAYS = 3

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function makeWindow(label: string, endDate: Date, days: number): SearchConsoleWindow {
  return {
    label,
    startDate: isoDate(addUtcDays(endDate, -(days - 1))),
    endDate: isoDate(endDate),
  }
}

export function resolveWindows(today: Date): SearchConsoleWindow[] {
  const completeEnd = addUtcDays(utcDay(today), -SEARCH_CONSOLE_DATA_LAG_DAYS)
  const current28 = makeWindow('28d', completeEnd, 28)
  const previous28End = addUtcDays(new Date(`${current28.startDate}T00:00:00.000Z`), -1)
  const current90 = makeWindow('90d', completeEnd, 90)
  const previous90End = addUtcDays(new Date(`${current90.startDate}T00:00:00.000Z`), -1)

  return [
    current28,
    makeWindow('28d-previous', previous28End, 28),
    current90,
    makeWindow('90d-previous', previous90End, 90),
  ]
}

export function baselineOutputPath(date: string, window: string): string {
  return `content/seo/baselines/${date}-${window}.json`
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEARCH_ANALYTICS_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

type SearchConsoleApiRow = {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

type SearchConsoleApiResponse = {
  rows?: SearchConsoleApiRow[]
}

type SearchConsoleRows = {
  queries: SearchConsoleQueryRow[]
  pages: SearchConsolePageRow[]
}

type AuditRecord = {
  operation: string
  url: string
  requestPayload: unknown
  responsePayload: unknown
  latencyMs: number
  status: number | null
}

function logAudit(record: AuditRecord): void {
  console.info(
    JSON.stringify({
      event: 'search_console_external_call',
      ...record,
    }),
  )
}

function responsePayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  const { access_token: _accessToken, ...safe } = value
  return safe
}

// hand-rolled service-account JWT; switch to googleapis if the API surface grows beyond searchAnalytics.query
async function createAccessToken(credentials: SearchConsoleCredentials): Promise<string> {
  const privateKey = await importPKCS8(credentials.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const requestPayload = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: '[redacted]',
  }
  const startedAt = performance.now()
  let status: number | null = null
  let parsed: unknown = null

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: requestPayload.grant_type,
        assertion,
      }),
    })
    status = response.status
    parsed = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        `Google OAuth token exchange failed (${response.status}): ${JSON.stringify(parsed)}`,
      )
    }
    if (!isRecord(parsed) || typeof parsed.access_token !== 'string') {
      throw new Error('Google OAuth token exchange returned no access token')
    }
    return parsed.access_token
  } finally {
    logAudit({
      operation: 'oauth_token_exchange',
      url: GOOGLE_TOKEN_URL,
      requestPayload,
      responsePayload: responsePayload(parsed),
      latencyMs: performance.now() - startedAt,
      status,
    })
  }
}

function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function apiRowToSearchConsoleRow(
  row: SearchConsoleApiRow,
  dimension: 'query' | 'page',
): SearchConsoleQueryRow | SearchConsolePageRow | null {
  const value = row.keys?.at(0)
  if (!value) return null

  const common = {
    clicks: numberOrZero(row.clicks),
    impressions: numberOrZero(row.impressions),
    ctr: numberOrZero(row.ctr),
    position: numberOrZero(row.position),
  }
  return dimension === 'query' ? { query: value, ...common } : { page: value, ...common }
}

async function fetchDimensionRows(
  accessToken: string,
  property: string,
  window: SearchConsoleWindow,
  dimension: 'query' | 'page',
): Promise<SearchConsoleQueryRow[] | SearchConsolePageRow[]> {
  const url = `${SEARCH_ANALYTICS_URL}/${encodeURIComponent(property)}/searchAnalytics/query`
  const requestPayload = {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: [dimension],
    rowLimit: 25_000,
    dataState: 'final',
  }
  const startedAt = performance.now()
  let status: number | null = null
  let parsed: SearchConsoleApiResponse | null = null

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    })
    status = response.status
    parsed = (await response.json().catch(() => null)) as SearchConsoleApiResponse | null

    if (!response.ok) {
      throw new Error(
        `Search Console ${dimension} query failed (${response.status}): ${JSON.stringify(parsed)}`,
      )
    }

    const apiRows = Array.isArray(parsed?.rows) ? parsed.rows : []
    return apiRows.flatMap((row) => {
      const converted = apiRowToSearchConsoleRow(row, dimension)
      return converted ? [converted] : []
    }) as SearchConsoleQueryRow[] | SearchConsolePageRow[]
  } finally {
    logAudit({
      operation: `search_analytics_${dimension}`,
      url,
      requestPayload,
      responsePayload: parsed,
      latencyMs: performance.now() - startedAt,
      status,
    })
  }
}

async function fetchWindowRows(
  accessToken: string,
  property: string,
  window: SearchConsoleWindow,
): Promise<SearchConsoleRows> {
  const [queries, pages] = await Promise.all([
    fetchDimensionRows(accessToken, property, window, 'query'),
    fetchDimensionRows(accessToken, property, window, 'page'),
  ])

  return {
    queries: queries as SearchConsoleQueryRow[],
    pages: pages as SearchConsolePageRow[],
  }
}

async function writeBaseline(
  outputPath: string,
  payload: {
    extractedAt: string
    property: string
    window: SearchConsoleWindow
    scorecard: Scorecard
  },
): Promise<void> {
  const absolutePath = resolve(process.cwd(), outputPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const { credentials, property } = assertSearchConsoleCredentials()
  const extractedAt = new Date().toISOString()
  const windows = resolveWindows(new Date())
  const accessToken = await createAccessToken(credentials)
  const exports = await Promise.all(
    windows.map(async (window) => {
      const rows = await fetchWindowRows(accessToken, property, window)
      const scorecard = buildScorecard(rows)
      const outputPath = baselineOutputPath(extractedAt.slice(0, 10), window.label)
      await writeBaseline(outputPath, { extractedAt, property, window, scorecard })
      return {
        window,
        outputPath,
        queryCount: rows.queries.length,
        pageCount: rows.pages.length,
      }
    }),
  )

  console.log(
    JSON.stringify(
      {
        event: 'search_console_export_complete',
        extractedAt,
        property,
        exports,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
