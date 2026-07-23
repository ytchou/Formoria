export type PostHogErrorCode =
  | 'posthog_unconfigured'
  | 'posthog_unavailable'
  | 'invalid_provider_response'
  | 'endpoint_missing'

type PostHogQueryClientErrorCode = Exclude<PostHogErrorCode, 'endpoint_missing'>

export class PostHogQueryError extends Error {
  public readonly code: PostHogQueryClientErrorCode

  constructor(
    code: PostHogErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message)
    // Preserve legacy query-client narrowing until endpoint consumers have a dedicated error boundary.
    this.code = code as PostHogQueryClientErrorCode
    this.name = 'PostHogQueryError'
  }
}

export type PostHogQueryResult = {
  columns: string[]
  results: unknown[][]
}

export interface PostHogQueryClient {
  run(name: string, query: string): Promise<PostHogQueryResult>
}

type AuditEvent = {
  provider: 'PostHog'
  queryName: string
  request: {
    endpoint: string
    payload:
      | { query: { kind: 'HogQLQuery'; query: string }; name: string }
      | { variables: Record<string, string> }
  }
  response: Record<string, unknown>
  latencyMs: number
  status: 'success' | 'error'
  outcome: PostHogErrorCode | 'success'
}

type Audit = (event: AuditEvent) => void

const SLOW_THRESHOLD_MS = 2_000

function defaultAudit(event: AuditEvent): void {
  if (event.status === 'error') {
    console.error(`[posthog-query:audit] ${event.queryName} failed (${event.outcome})`, event.response?.httpStatus ?? 'no status')
  } else if (event.latencyMs >= SLOW_THRESHOLD_MS) {
    console.warn(`[posthog-query:audit] ${event.queryName} slow (${event.latencyMs}ms)`)
  }
}

function configuration(): {
  projectId: string
  personalApiKey: string
  apiHost: string
} {
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim()
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim()
  const apiHost = process.env.POSTHOG_API_HOST?.trim().replace(/\/$/, '')

  if (!projectId || !personalApiKey || apiHost !== 'https://us.posthog.com') {
    throw new PostHogQueryError(
      'posthog_unconfigured',
      'PostHog Query API is not configured.',
    )
  }

  return { projectId, personalApiKey, apiHost }
}

function validResult(value: unknown): value is PostHogQueryResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return Array.isArray(candidate.columns)
    && candidate.columns.every((column) => typeof column === 'string')
    && Array.isArray(candidate.results)
    && candidate.results.every((row) => Array.isArray(row))
}

function sanitizedResultForAudit(result: PostHogQueryResult): Record<string, unknown> {
  return {
    columns: result.columns,
    resultCount: result.results.length,
    results: result.results.map((row) => row.map((value) =>
      value === null || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : '[redacted]',
    )),
  }
}

export function createPostHogQueryClient({
  fetchImpl = fetch,
  audit = defaultAudit,
  timeoutMs = 8_000,
}: {
  fetchImpl?: typeof fetch
  audit?: Audit
  timeoutMs?: number
} = {}): PostHogQueryClient {
  return {
    async run(name, query) {
      const { projectId, personalApiKey, apiHost } = configuration()
      const endpoint = `${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`
      const payload = {
        query: { kind: 'HogQLQuery' as const, query },
        name,
      }
      const startedAt = performance.now()

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${personalApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const body: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          const error = new PostHogQueryError(
            'posthog_unavailable',
            'PostHog Query API is unavailable.',
            response.status,
          )
          audit({
            provider: 'PostHog',
            queryName: name,
            request: { endpoint, payload },
            response: { httpStatus: response.status, body: { error: error.code } },
            latencyMs: Math.round(performance.now() - startedAt),
            status: 'error',
            outcome: error.code,
          })
          throw error
        }

        if (!validResult(body)) {
          const error = new PostHogQueryError(
            'invalid_provider_response',
            'PostHog returned an invalid query response.',
            response.status,
          )
          audit({
            provider: 'PostHog',
            queryName: name,
            request: { endpoint, payload },
            response: { httpStatus: response.status, body: { error: error.code } },
            latencyMs: Math.round(performance.now() - startedAt),
            status: 'error',
            outcome: error.code,
          })
          throw error
        }

        audit({
          provider: 'PostHog',
          queryName: name,
          request: { endpoint, payload },
          response: { httpStatus: response.status, body: sanitizedResultForAudit(body) },
          latencyMs: Math.round(performance.now() - startedAt),
          status: 'success',
          outcome: 'success',
        })
        return body
      } catch (error) {
        if (error instanceof PostHogQueryError) throw error

        const providerError = new PostHogQueryError(
          'posthog_unavailable',
          'PostHog Query API is unavailable.',
        )
        audit({
          provider: 'PostHog',
          queryName: name,
          request: { endpoint, payload },
          response: { httpStatus: null, body: { error: providerError.code } },
          latencyMs: Math.round(performance.now() - startedAt),
          status: 'error',
          outcome: providerError.code,
        })
        throw providerError
      }
    },
  }
}

export function createPostHogEndpointClient({
  fetchImpl = fetch,
  audit = defaultAudit,
  timeoutMs = 8_000,
}: {
  fetchImpl?: typeof fetch
  audit?: Audit
  timeoutMs?: number
} = {}): {
  runEndpoint(
    name: string,
    version: number,
    variables: Record<string, string>,
  ): Promise<PostHogQueryResult>
} {
  return {
    async runEndpoint(name, version, variables) {
      const { projectId, personalApiKey, apiHost } = configuration()
      const endpoint = `${apiHost}/api/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(name)}/run?version=${encodeURIComponent(String(version))}`
      const payload = { variables }
      const startedAt = performance.now()

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${personalApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const body: unknown = await response.json().catch(() => null)

        if (!response.ok) {
          const error = response.status === 404
            ? new PostHogQueryError(
                'endpoint_missing',
                'PostHog endpoint does not exist.',
                response.status,
              )
            : new PostHogQueryError(
                'posthog_unavailable',
                'PostHog Endpoint API is unavailable.',
                response.status,
              )
          audit({
            provider: 'PostHog',
            queryName: name,
            request: { endpoint, payload },
            response: { httpStatus: response.status, body: { error: error.code } },
            latencyMs: Math.round(performance.now() - startedAt),
            status: 'error',
            outcome: error.code,
          })
          throw error
        }

        if (!validResult(body)) {
          const error = new PostHogQueryError(
            'invalid_provider_response',
            'PostHog returned an invalid endpoint response.',
            response.status,
          )
          audit({
            provider: 'PostHog',
            queryName: name,
            request: { endpoint, payload },
            response: { httpStatus: response.status, body: { error: error.code } },
            latencyMs: Math.round(performance.now() - startedAt),
            status: 'error',
            outcome: error.code,
          })
          throw error
        }

        audit({
          provider: 'PostHog',
          queryName: name,
          request: { endpoint, payload },
          response: { httpStatus: response.status, body: sanitizedResultForAudit(body) },
          latencyMs: Math.round(performance.now() - startedAt),
          status: 'success',
          outcome: 'success',
        })
        return body
      } catch (error) {
        if (error instanceof PostHogQueryError) throw error

        const providerError = new PostHogQueryError(
          'posthog_unavailable',
          'PostHog Endpoint API is unavailable.',
        )
        audit({
          provider: 'PostHog',
          queryName: name,
          request: { endpoint, payload },
          response: { httpStatus: null, body: { error: providerError.code } },
          latencyMs: Math.round(performance.now() - startedAt),
          status: 'error',
          outcome: providerError.code,
        })
        throw providerError
      }
    },
  }
}
