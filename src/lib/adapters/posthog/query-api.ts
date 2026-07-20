export type PostHogErrorCode =
  | 'posthog_unconfigured'
  | 'posthog_unavailable'
  | 'invalid_provider_response'

export class PostHogQueryError extends Error {
  constructor(
    public readonly code: PostHogErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message)
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
    payload: { query: { kind: 'HogQLQuery'; query: string }; name: string }
  }
  response: Record<string, unknown>
  latencyMs: number
  status: 'success' | 'error'
  outcome: PostHogErrorCode | 'success'
}

type Audit = (event: AuditEvent) => void

function defaultAudit(event: AuditEvent): void {
  console.info('[posthog-query:audit]', event)
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
          response: { httpStatus: response.status, body },
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
