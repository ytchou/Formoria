import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { importPKCS8, SignJWT } from 'jose'
import {
  classifyLandingPage,
  classifyQuery,
  QUERY_CLUSTERS,
  type LandingPageType,
  type QueryCluster,
} from '@/lib/seo/search-console/segmentation'
import { loadScriptTarget } from '../shared/target'

/**
 * `position` is optional on purpose: Search Console omits it for rows it has no
 * ranking for. Coercing an absent position to 0 would count the row as a top-3
 * ranking and drag the impression-weighted average toward zero.
 */
export type SearchConsoleQueryRow = {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position?: number | null
}

export type SearchConsolePageRow = {
  page: string
  clicks: number
  impressions: number
  ctr: number
  position?: number | null
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
  /** Impressions of the rows that actually carry a position — the weighted denominator. */
  positionedImpressions: number
  weightedPositionTotal: number
  plainPositionTotal: number
  /** Rows carrying a position, not rows in the cluster. */
  positionedRowCount: number
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

const PEM_HEADER = '-----BEGIN PRIVATE KEY-----'
const PEM_FOOTER = '-----END PRIVATE KEY-----'

/**
 * Env files and secret managers routinely deliver the key with its newlines
 * double-escaped (`\\n` survives JSON.parse as the two characters `\` + `n`).
 * `importPKCS8` then fails deep inside jose with an opaque "Failed to parse the
 * PEM", which is the one error the preflight exists to prevent — so normalize
 * here and validate the delimiters while we still own the message.
 */
export function normalizePrivateKey(raw: string): string {
  return raw.replaceAll('\\r\\n', '\n').replaceAll('\\n', '\n').replaceAll('\r\n', '\n').trim()
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

  const private_key = normalizePrivateKey(parsed.private_key)
  if (!private_key.startsWith(PEM_HEADER) || !private_key.endsWith(PEM_FOOTER)) {
    throw new MissingSearchConsoleCredentialsError(
      `Invalid ${SEARCH_CONSOLE_CREDENTIALS_ENV}: private_key must be a PKCS#8 PEM delimited by "${PEM_HEADER}" and "${PEM_FOOTER}". ${provisionInstructions()}`,
    )
  }

  return {
    credentials: {
      client_email: parsed.client_email,
      private_key,
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

/**
 * An absent position is ABSENT, not 0: position 1 is the best possible ranking,
 * so 0 is out of range. Rows without one are excluded from the buckets and from
 * the impression-weighted average rather than being scored as top-3.
 */
export function reportedPosition(position: number | null | undefined): number | null {
  return typeof position === 'number' && Number.isFinite(position) && position > 0
    ? position
    : null
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
    positionedImpressions: 0,
    weightedPositionTotal: 0,
    plainPositionTotal: 0,
    positionedRowCount: 0,
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
    const position = reportedPosition(row.position)

    if (cluster) {
      addMetric(cluster, row)
      if (position !== null) {
        cluster.positionedImpressions += row.impressions
        cluster.weightedPositionTotal += position * row.impressions
        cluster.plainPositionTotal += position
        cluster.positionedRowCount += 1
      }
    }

    if (classification.cluster === 'branded') addMetric(brandedAccumulator, row)
    else addMetric(nonBrandAccumulator, row)

    if (position !== null) positionBuckets[positionBucket(position)] += 1
  }

  const pageTotals = new Map<LandingPageType, MetricAccumulator>()
  const landingPageTotals = new Map<string, LandingPageTotal>()
  // One accumulator per page type, keyed by CANONICAL page. `l1Pages`/`l2Pages`
  // are projections of it, so adding a per-page-type breakdown never means
  // copying this block again.
  const canonicalPageImpressions = new Map<LandingPageType, Map<string, number>>()

  for (const row of rows.pages) {
    const classification = classifyLandingPage(row.page)
    const pageTypeTotal = pageTotals.get(classification.pageType) ?? { impressions: 0, clicks: 0 }
    addMetric(pageTypeTotal, row)
    pageTotals.set(classification.pageType, pageTypeTotal)

    // landingPages stays keyed on the RAW URL: a per-URL listing is what Search
    // Console actually reports, and collapsing it would hide locale and
    // parameter variants an operator needs to see.
    const landingPageTotal = landingPageTotals.get(row.page) ?? {
      page: row.page,
      impressions: 0,
      clicks: 0,
    }
    landingPageTotal.impressions += row.impressions
    landingPageTotal.clicks += row.clicks
    landingPageTotals.set(row.page, landingPageTotal)

    // L1/L2 group by canonical page: /brands?category=bags,
    // /en/brands?category=bags and /brands?category=bags&page=2 are one page.
    const canonicalTotals =
      canonicalPageImpressions.get(classification.pageType) ?? new Map<string, number>()
    canonicalTotals.set(
      classification.canonicalPage,
      (canonicalTotals.get(classification.canonicalPage) ?? 0) + row.impressions,
    )
    canonicalPageImpressions.set(classification.pageType, canonicalTotals)
  }

  const clusterScores = QUERY_CLUSTERS.map((cluster): QueryClusterScore => {
    const aggregate = clusters.get(cluster) ?? emptyClusterAccumulator()
    // Average position is impression-weighted over the rows that HAVE a
    // position; when those rows carry no impressions, use a plain mean.
    const averagePosition =
      aggregate.positionedImpressions > 0
        ? aggregate.weightedPositionTotal / aggregate.positionedImpressions
        : aggregate.positionedRowCount > 0
          ? aggregate.plainPositionTotal / aggregate.positionedRowCount
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
    l1Pages: Object.fromEntries(canonicalPageImpressions.get('l1-category') ?? []),
    l2Pages: Object.fromEntries(canonicalPageImpressions.get('l2-category') ?? []),
  }
}

export type SearchConsoleWindow = {
  label: string
  startDate: string
  endDate: string
}

// Search Console data can lag by several days; exclude the latest three days as incomplete.
export const SEARCH_CONSOLE_DATA_LAG_DAYS = 3

/**
 * WINDOW TIMEZONE BASIS: Asia/Taipei (UTC+8, no DST).
 *
 * `src/lib/date-range.ts` states analytics windows are Taipei-based, and the
 * PostHog project timezone this scorecard reconciles against is Asia/Taipei. A
 * UTC calendar day would put every run between 00:00 and 08:00 Taipei on the
 * PREVIOUS Taipei day, silently offsetting the GSC window from the PostHog one
 * by a day. `date-range.ts` is not reusable here — `shiftIsoDate` is
 * module-private and `dateRangeForPastDays` has no data-lag offset — so the
 * day boundary is recomputed rather than imported.
 *
 * The returned anchors are UTC-midnight Dates STANDING FOR a Taipei calendar
 * day; only their ISO date is ever emitted. (Search Console itself reports in
 * the property's own timezone — see scorecard-definitions.md.)
 */
const TAIPEI_UTC_OFFSET_MINUTES = 8 * 60

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function taipeiDay(date: Date): Date {
  const shifted = new Date(date.getTime() + TAIPEI_UTC_OFFSET_MINUTES * 60_000)
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  )
}

function makeWindow(label: string, endDate: Date, days: number): SearchConsoleWindow {
  return {
    label,
    startDate: isoDate(addDays(endDate, -(days - 1))),
    endDate: isoDate(endDate),
  }
}

export function resolveWindows(today: Date): SearchConsoleWindow[] {
  const completeEnd = addDays(taipeiDay(today), -SEARCH_CONSOLE_DATA_LAG_DAYS)
  const current28 = makeWindow('28d', completeEnd, 28)
  const previous28End = addDays(new Date(`${current28.startDate}T00:00:00.000Z`), -1)
  const current90 = makeWindow('90d', completeEnd, 90)
  const previous90End = addDays(new Date(`${current90.startDate}T00:00:00.000Z`), -1)

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

/**
 * Baselines are repo artifacts, so they resolve against the repo root — this
 * file is `<root>/scripts/seo/`. Resolving against process.cwd() instead let a
 * run from any other directory quietly `mkdir -p` a parallel
 * `content/seo/baselines` tree and still print a successful-looking summary.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function resolveFromRepoRoot(relativePath: string): string {
  return isAbsolute(relativePath) ? relativePath : resolve(REPO_ROOT, relativePath)
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

function commonRowMetrics(row: SearchConsoleApiRow): {
  clicks: number
  impressions: number
  ctr: number
  position: number | null
} {
  return {
    clicks: numberOrZero(row.clicks),
    impressions: numberOrZero(row.impressions),
    ctr: numberOrZero(row.ctr),
    position: reportedPosition(row.position),
  }
}

/** Search Console signals "there is more" only by returning exactly `rowLimit`. */
export const SEARCH_CONSOLE_ROW_LIMIT = 25_000
/** Safety cap so a pathological property can never loop forever. */
export const SEARCH_CONSOLE_MAX_ROWS = 250_000

export type SearchAnalyticsRequest = {
  startDate: string
  endDate: string
  dimensions: string[]
  rowLimit: number
  startRow: number
  dataState: string
}

/** Injected so the pagination loop is testable without credentials. */
export type SearchAnalyticsFetcher = (
  request: SearchAnalyticsRequest,
) => Promise<SearchConsoleApiRow[]>

/**
 * Pages through searchAnalytics with `startRow` until a page comes back short.
 * Without this a >25k-row 90d window is silently truncated, and the truncated
 * numbers are then committed as THE baseline every later period-over-period
 * comparison is measured against.
 */
export async function collectApiRows(
  fetchPage: SearchAnalyticsFetcher,
  window: SearchConsoleWindow,
  dimension: 'query' | 'page',
): Promise<SearchConsoleApiRow[]> {
  const rows: SearchConsoleApiRow[] = []

  while (rows.length < SEARCH_CONSOLE_MAX_ROWS) {
    const rowLimit = Math.min(SEARCH_CONSOLE_ROW_LIMIT, SEARCH_CONSOLE_MAX_ROWS - rows.length)
    const page = await fetchPage({
      startDate: window.startDate,
      endDate: window.endDate,
      dimensions: [dimension],
      rowLimit,
      startRow: rows.length,
      dataState: 'final',
    })

    rows.push(...page)
    if (page.length < rowLimit) return rows
  }

  console.warn(
    JSON.stringify({
      event: 'search_console_row_cap_reached',
      dimension,
      window: window.label,
      rowCount: rows.length,
      cap: SEARCH_CONSOLE_MAX_ROWS,
    }),
  )
  return rows
}

export async function fetchQueryRows(
  fetchPage: SearchAnalyticsFetcher,
  window: SearchConsoleWindow,
): Promise<SearchConsoleQueryRow[]> {
  const apiRows = await collectApiRows(fetchPage, window, 'query')
  return apiRows.flatMap((row) => {
    const query = row.keys?.at(0)
    return query ? [{ query, ...commonRowMetrics(row) }] : []
  })
}

export async function fetchPageRows(
  fetchPage: SearchAnalyticsFetcher,
  window: SearchConsoleWindow,
): Promise<SearchConsolePageRow[]> {
  const apiRows = await collectApiRows(fetchPage, window, 'page')
  return apiRows.flatMap((row) => {
    const page = row.keys?.at(0)
    return page ? [{ page, ...commonRowMetrics(row) }] : []
  })
}

function createSearchAnalyticsFetcher(
  accessToken: string,
  property: string,
): SearchAnalyticsFetcher {
  const url = `${SEARCH_ANALYTICS_URL}/${encodeURIComponent(property)}/searchAnalytics/query`

  return async (requestPayload) => {
    const startedAt = performance.now()
    let status: number | null = null
    let parsed: SearchConsoleApiResponse | null = null
    let apiRows: SearchConsoleApiRow[] = []

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
          `Search Console ${requestPayload.dimensions.join(',')} query failed (${response.status}): ${JSON.stringify(parsed)}`,
        )
      }

      apiRows = Array.isArray(parsed?.rows) ? parsed.rows : []
      return apiRows
    } finally {
      logAudit({
        operation: `search_analytics_${requestPayload.dimensions.join('_')}`,
        url,
        requestPayload,
        // Row count only: the full response is up to 25k rows per call and the
        // rows are already persisted to content/seo/baselines/. Dumping them
        // here buries the run summary and breaks `pnpm seo:gsc-export | jq`.
        responsePayload: { rowCount: apiRows.length },
        latencyMs: performance.now() - startedAt,
        status,
      })
    }
  }
}

async function fetchWindowRows(
  fetchPage: SearchAnalyticsFetcher,
  window: SearchConsoleWindow,
): Promise<SearchConsoleRows> {
  const [queries, pages] = await Promise.all([
    fetchQueryRows(fetchPage, window),
    fetchPageRows(fetchPage, window),
  ])

  return { queries, pages }
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
  const absolutePath = resolveFromRepoRoot(outputPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  loadScriptTarget()
  const { credentials, property } = assertSearchConsoleCredentials()
  const extractedAt = new Date().toISOString()
  const windows = resolveWindows(new Date())
  const accessToken = await createAccessToken(credentials)
  const fetchPage = createSearchAnalyticsFetcher(accessToken, property)
  const exports = await Promise.all(
    windows.map(async (window) => {
      const rows = await fetchWindowRows(fetchPage, window)
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
