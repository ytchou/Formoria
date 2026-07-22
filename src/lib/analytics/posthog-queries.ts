export type OwnerEndpointDef = {
  name: string
  version: number
  dataFreshnessSeconds: 900
  variables: Record<string, { type: 'String'; default: string }>
  hogql: string
  insight: { name: string; hogql: string }
}

type OwnerEndpointName =
  | 'brand_core_totals'
  | 'brand_daily_trend'
  | 'brand_traffic_sources'
  | 'brand_outbound_destinations'

const TIME_ZONE = 'Asia/Taipei'
const SESSION_ID = 'properties.$session_id'
const PUBLIC_EVENT = `equals(properties.analytics_schema_version, 1)
  AND equals(properties.surface, 'public')`
const ENDPOINT_SCOPE = 'equals(properties.brand_id, {variables.brand_id})'
const INSIGHT_SCOPE = '{filters}'

function profileSessions(scope: string, startDays = 30, endDays?: number): string {
  return `SELECT DISTINCT ${SESSION_ID}
FROM events
WHERE event = 'brand_detail_viewed'
  AND ${PUBLIC_EVENT}
  AND ${scope}
  AND timestamp >= now() - INTERVAL ${startDays} DAY${endDays === undefined ? '' : `
  AND timestamp < now() - INTERVAL ${endDays} DAY`}`
}

function coreQuery(scope: string): string {
  return `
SELECT
  (SELECT toString(minOrNull(toDate(toTimeZone(timestamp, '${TIME_ZONE}'))))
   FROM events
   WHERE event = 'brand_detail_viewed'
     AND ${PUBLIC_EVENT}
     AND ${scope}) AS available_from,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND timestamp >= now() - INTERVAL 30 DAY) AS current_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed' AND timestamp >= now() - INTERVAL 60 DAY AND timestamp < now() - INTERVAL 30 DAY) AS prior_profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND timestamp >= now() - INTERVAL 30 DAY AND ${SESSION_ID} IN (${profileSessions(scope)})) AS current_outbound_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND timestamp >= now() - INTERVAL 60 DAY AND timestamp < now() - INTERVAL 30 DAY AND ${SESSION_ID} IN (${profileSessions(scope, 60, 30)})) AS prior_outbound_sessions
FROM events
WHERE ${PUBLIC_EVENT}
  AND ${scope}
  AND timestamp >= now() - INTERVAL 60 DAY
`.trim()
}

function dailyTrendQuery(scope: string): string {
  return `
SELECT
  toString(toDate(toTimeZone(timestamp, '${TIME_ZONE}'))) AS date,
  uniqIf(${SESSION_ID}, event = 'brand_detail_viewed') AS profile_sessions,
  uniqIf(${SESSION_ID}, event = 'external_link_clicked' AND ${SESSION_ID} IN (${profileSessions(scope)})) AS outbound_sessions
FROM events
WHERE ${PUBLIC_EVENT}
  AND ${scope}
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY date
ORDER BY date
`.trim()
}

function trafficSourcesQuery(scope: string): string {
  return `
SELECT source, uniq(session_id) AS sessions
FROM (
  SELECT
    session_id,
    multiIf(
      previous_path IS NULL, 'direct',
      normalized_previous_path = '/search' OR startsWith(normalized_previous_path, '/search/') OR notEmpty(extractURLParameter(previous_url, 'q')), 'search',
      normalized_previous_path = '/brands' AND notEmpty(extractURLParameter(previous_url, 'category')), 'category',
      previous_path IN ('/', '/en', '/zh-TW') OR normalized_previous_path = '/', 'homepage',
      'other'
    ) AS source
  FROM (
    SELECT
      session_id,
      event,
      is_target,
      previous_path,
      previous_url,
      if(previous_path IN ('/en', '/zh-TW'), '/', replaceRegexpOne(previous_path, '^/(en|zh-TW)/', '/')) AS normalized_previous_path
    FROM (
      SELECT
        ${SESSION_ID} AS session_id,
        event,
        event = 'brand_detail_viewed' AND ${scope} AS is_target,
        LAG(coalesce(nullIf(properties.$pathname, ''), path(properties.$current_url))) OVER (PARTITION BY ${SESSION_ID} ORDER BY timestamp) AS previous_path,
        LAG(properties.$current_url) OVER (PARTITION BY ${SESSION_ID} ORDER BY timestamp) AS previous_url
      FROM events
      WHERE (event = '$pageview' OR (event = 'brand_detail_viewed' AND ${PUBLIC_EVENT} AND ${scope}))
        AND timestamp >= now() - INTERVAL 31 DAY
        AND ${SESSION_ID} IN (${profileSessions(scope)})
    )
  )
  WHERE is_target
)
GROUP BY source
ORDER BY sessions DESC
`.trim()
}

function outboundDestinationsQuery(scope: string): string {
  return `
SELECT properties.link_type AS destination, uniq(${SESSION_ID}) AS sessions
FROM events
WHERE event = 'external_link_clicked'
  AND ${PUBLIC_EVENT}
  AND ${scope}
  AND timestamp >= now() - INTERVAL 30 DAY
  AND ${SESSION_ID} IN (${profileSessions(scope)})
GROUP BY destination
ORDER BY sessions DESC
`.trim()
}

function endpoint(
  name: string,
  insightName: string,
  query: (scope: string) => string,
): OwnerEndpointDef {
  return {
    name,
    version: 1,
    dataFreshnessSeconds: 900,
    variables: { brand_id: { type: 'String', default: '' } },
    hogql: query(ENDPOINT_SCOPE),
    insight: { name: insightName, hogql: query(INSIGHT_SCOPE) },
  }
}

export const SITE_DASHBOARD_NAME = 'Formoria — Site analytics'

export const OWNER_ENDPOINTS: Record<OwnerEndpointName, OwnerEndpointDef> = {
  brand_core_totals: endpoint(
    'brand_core_totals',
    'Site analytics — Core totals',
    coreQuery,
  ),
  brand_daily_trend: endpoint(
    'brand_daily_trend',
    'Site analytics — Daily trend',
    dailyTrendQuery,
  ),
  brand_traffic_sources: endpoint(
    'brand_traffic_sources',
    'Site analytics — Traffic sources',
    trafficSourcesQuery,
  ),
  brand_outbound_destinations: endpoint(
    'brand_outbound_destinations',
    'Site analytics — Outbound destinations',
    outboundDestinationsQuery,
  ),
}

export function listOwnerEndpoints(): OwnerEndpointDef[] {
  return Object.values(OWNER_ENDPOINTS)
}
