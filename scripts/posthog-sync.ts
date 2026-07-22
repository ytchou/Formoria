import {
  listOwnerEndpoints,
  OWNER_ENDPOINTS,
  SITE_DASHBOARD_NAME,
  type OwnerEndpointDef,
} from '@/lib/analytics/posthog-queries'

type EndpointPayload = {
  name: string
  query: { kind: 'HogQLQuery'; query: string }
  variables: Record<string, { type: 'String'; default: string }>
  data_freshness_seconds: number
  is_materialized: false
}

type InsightPayload = {
  name: string
  query: { kind: 'HogQLQuery'; query: string }
}

type NamedResource = {
  id: string | number
  name: string
}

type EndpointResource = NamedResource & {
  version?: number
}

type InsightResource = NamedResource
type DashboardResource = NamedResource
type ApiList<T> = T[] | { results: T[] }

export function buildEndpointPayload(def: OwnerEndpointDef): EndpointPayload {
  return {
    name: def.name,
    query: { kind: 'HogQLQuery', query: def.hogql },
    variables: def.variables,
    data_freshness_seconds: def.dataFreshnessSeconds,
    is_materialized: false,
  }
}

export function buildInsightPayload(def: OwnerEndpointDef): InsightPayload {
  return {
    name: def.insight.name,
    query: { kind: 'HogQLQuery', query: def.insight.hogql },
  }
}

export function planSyncActions(
  existing: { name: string }[],
  desired: string[],
): { create: string[]; update: string[] } {
  const existingNames = new Set(existing.map(({ name }) => name))

  return {
    create: desired.filter((name) => !existingNames.has(name)),
    update: desired.filter((name) => existingNames.has(name)),
  }
}

function configuration(): {
  baseUrl: string
  headers: Record<string, string>
} {
  const apiHost = process.env.POSTHOG_API_HOST?.trim().replace(/\/$/, '')
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim()
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim()

  if (!apiHost || !personalApiKey || !projectId) {
    throw new Error(
      'POSTHOG_API_HOST, POSTHOG_PERSONAL_API_KEY, and POSTHOG_PROJECT_ID are required.',
    )
  }

  return {
    baseUrl: `${apiHost}/api/projects/${encodeURIComponent(projectId)}`,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${personalApiKey}`,
      'Content-Type': 'application/json',
    },
  }
}

function listResults<T>(response: ApiList<T>): T[] {
  return Array.isArray(response) ? response : response.results
}

function errorDetail(body: unknown): string {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') return JSON.stringify(body)
  return 'No response body'
}

function createPostHogClient(): {
  request<T>(path: string, method?: 'GET' | 'POST' | 'PATCH', payload?: unknown): Promise<T>
} {
  const { baseUrl, headers } = configuration()

  return {
    async request<T>(
      path: string,
      method: 'GET' | 'POST' | 'PATCH' = 'GET',
      payload?: unknown,
    ): Promise<T> {
      const startedAt = performance.now()
      let responseBody: unknown = null

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: payload === undefined ? undefined : JSON.stringify(payload),
        })
        responseBody = await response.json().catch(() => null)
        console.info('[posthog-sync:audit]', {
          request: { method, path, payload: payload ?? null },
          response: { httpStatus: response.status, body: responseBody },
          latencyMs: Math.round(performance.now() - startedAt),
          status: response.ok ? 'success' : 'error',
        })

        if (!response.ok) {
          throw new Error(
            `${method} ${path} failed (${response.status}): ${errorDetail(responseBody)}`,
          )
        }

        return responseBody as T
      } catch (error) {
        if (responseBody === null) {
          console.error('[posthog-sync:audit]', {
            request: { method, path, payload: payload ?? null },
            response: {
              httpStatus: null,
              body: error instanceof Error ? error.message : 'Unknown error',
            },
            latencyMs: Math.round(performance.now() - startedAt),
            status: 'error',
          })
        }
        throw error
      }
    },
  }
}

async function upsertEndpoints(
  client: ReturnType<typeof createPostHogClient>,
  failures: string[],
): Promise<void> {
  const listed = await client.request<ApiList<EndpointResource>>('/endpoints/')
  const existing = listResults(listed)
  const existingByName = new Map(existing.map((endpoint) => [endpoint.name, endpoint]))

  for (const def of listOwnerEndpoints()) {
    const current = existingByName.get(def.name)

    try {
      if (!current) {
        const created = await client.request<EndpointResource>(
          '/endpoints/',
          'POST',
          buildEndpointPayload(def),
        )
        console.info(`${def.name}: created${created.version === undefined ? '' : ` v${created.version}`}`)
        continue
      }

      const updated = await client.request<EndpointResource>(
        `/endpoints/${encodeURIComponent(String(current.id))}/`,
        'PATCH',
        buildEndpointPayload(def),
      )
      if (
        current.version !== undefined
        && updated.version !== undefined
        && current.version !== updated.version
      ) {
        console.info(`${def.name}: v${current.version} → v${updated.version}`)
      }
    } catch (error) {
      failures.push(`endpoint ${def.name}`)
      console.error(`Failed to sync endpoint ${def.name}:`, error)
    }
  }
}

async function upsertInsights(
  client: ReturnType<typeof createPostHogClient>,
  failures: string[],
): Promise<Array<string | number>> {
  const listed = await client.request<ApiList<InsightResource>>('/insights/?limit=100')
  const existing = listResults(listed)
  const existingByName = new Map(existing.map((insight) => [insight.name, insight]))
  const insightIds: Array<string | number> = []

  for (const def of listOwnerEndpoints()) {
    const payload = buildInsightPayload(def)
    const current = existingByName.get(payload.name)

    try {
      const insight = current
        ? await client.request<InsightResource>(
            `/insights/${encodeURIComponent(String(current.id))}/`,
            'PATCH',
            payload,
          )
        : await client.request<InsightResource>('/insights/', 'POST', payload)
      insightIds.push(insight.id)
      console.info(`${payload.name}: ${current ? 'updated' : 'created'}`)
    } catch (error) {
      failures.push(`insight ${payload.name}`)
      console.error(`Failed to sync insight ${payload.name}:`, error)
    }
  }

  return insightIds
}

async function syncDashboard(
  client: ReturnType<typeof createPostHogClient>,
  insightIds: Array<string | number>,
): Promise<void> {
  const search = encodeURIComponent(SITE_DASHBOARD_NAME)
  const listed = await client.request<ApiList<DashboardResource>>(`/dashboards/?search=${search}`)
  const dashboard = listResults(listed).find(({ name }) => name === SITE_DASHBOARD_NAME)
  const payload = { name: SITE_DASHBOARD_NAME, insight_ids: insightIds }

  if (dashboard) {
    await client.request(
      `/dashboards/${encodeURIComponent(String(dashboard.id))}/`,
      'PATCH',
      payload,
    )
    console.info(`${SITE_DASHBOARD_NAME}: updated`)
    return
  }

  await client.request('/dashboards/', 'POST', payload)
  console.info(`${SITE_DASHBOARD_NAME}: created`)
}

async function main(): Promise<void> {
  const client = createPostHogClient()
  const failures: string[] = []

  await upsertEndpoints(client, failures)
  const insightIds = await upsertInsights(client, failures)

  if (insightIds.length === Object.keys(OWNER_ENDPOINTS).length) {
    try {
      await syncDashboard(client, insightIds)
    } catch (error) {
      failures.push('dashboard')
      console.error(`Failed to sync dashboard ${SITE_DASHBOARD_NAME}:`, error)
    }
  } else {
    failures.push('dashboard')
    console.error(`Skipped dashboard sync because not all insights were upserted.`)
  }

  if (failures.length > 0) {
    throw new Error(`PostHog sync failed for: ${failures.join(', ')}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error('PostHog sync failed:', error)
    process.exitCode = 1
  })
}
