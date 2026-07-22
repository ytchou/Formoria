import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PostHogQueryError,
  createPostHogEndpointClient,
  createPostHogQueryClient,
} from './query-api'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function configure() {
  vi.stubEnv('POSTHOG_PROJECT_ID', '12345')
  vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_secret')
  vi.stubEnv('POSTHOG_API_HOST', 'https://us.posthog.com')
}

describe('PostHog Query API adapter', () => {
  it('requires complete server-only configuration before requesting PostHog', async () => {
    const fetchMock = vi.fn()
    const client = createPostHogQueryClient({ fetchImpl: fetchMock })

    await expect(client.run('core totals', 'select 1')).rejects.toMatchObject({
      code: 'posthog_unconfigured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send the personal key to a non-US PostHog API host', async () => {
    configure()
    vi.stubEnv('POSTHOG_API_HOST', 'https://example.com')
    const fetchMock = vi.fn()
    const client = createPostHogQueryClient({ fetchImpl: fetchMock })

    await expect(client.run('core totals', 'select 1')).rejects.toMatchObject({
      code: 'posthog_unconfigured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a named HogQL query and audits payload, response, latency, and status without credentials', async () => {
    configure()
    const audit = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ columns: ['value'], results: [[7]] }))
    const client = createPostHogQueryClient({ fetchImpl: fetchMock, audit })

    await expect(client.run('core totals', 'select 7')).resolves.toEqual({
      columns: ['value'],
      results: [[7]],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://us.posthog.com/api/projects/12345/query/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer phx_secret' }),
        body: JSON.stringify({
          query: { kind: 'HogQLQuery', query: 'select 7' },
          name: 'core totals',
        }),
      }),
    )
    const auditJson = JSON.stringify(audit.mock.calls)
    expect(auditJson).toContain('core totals')
    expect(auditJson).toContain('select 7')
    expect(auditJson).toContain('[[7]]')
    expect(auditJson).not.toContain('phx_secret')
  })

  it.each([401, 429, 500])('maps provider status %s to posthog_unavailable', async (status) => {
    configure()
    const client = createPostHogQueryClient({
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ detail: 'provider detail' }, { status })),
      audit: vi.fn(),
    })

    await expect(client.run('core totals', 'select 1')).rejects.toMatchObject({
      code: 'posthog_unavailable',
      httpStatus: status,
    })
  })

  it('redacts string result values from the audit trail', async () => {
    configure()
    const audit = vi.fn()
    const client = createPostHogQueryClient({
      fetchImpl: vi.fn().mockResolvedValue(Response.json({
        columns: ['source', 'sessions'],
        results: [['private@example.com', 4]],
      })),
      audit,
    })

    await client.run('acquisition', 'select source, sessions')

    const auditJson = JSON.stringify(audit.mock.calls)
    expect(auditJson).toContain('[redacted]')
    expect(auditJson).toContain('[[\"[redacted]\",4]]')
    expect(auditJson).not.toContain('private@example.com')
  })

  it('rejects structurally invalid provider responses', async () => {
    configure()
    const client = createPostHogQueryClient({
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ results: 'not-an-array' })),
      audit: vi.fn(),
    })

    await expect(client.run('core totals', 'select 1')).rejects.toEqual(
      expect.objectContaining({ code: 'invalid_provider_response' }),
    )
  })

  it('times out bounded requests', async () => {
    configure()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
    )
    const client = createPostHogQueryClient({ fetchImpl, audit: vi.fn(), timeoutMs: 5 })

    await expect(client.run('core totals', 'select 1')).rejects.toBeInstanceOf(PostHogQueryError)
    await expect(client.run('core totals', 'select 1')).rejects.toMatchObject({
      code: 'posthog_unavailable',
    })
  })
})

describe('createPostHogEndpointClient', () => {
  it('POSTs variables to the versioned endpoint run URL with bearer auth', async () => {
    configure()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [[12, 3]], columns: ['profile_sessions', 'outbound_sessions'] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createPostHogEndpointClient()
    const result = await client.runEndpoint('brand_core_totals', 2, { brand_id: 'b-123' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/endpoints/brand_core_totals/run?version=2')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ variables: { brand_id: 'b-123' } })
    expect((init as RequestInit).headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer /) })
    expect(result.results).toEqual([[12, 3]])
  })

  it('maps 404 to an endpoint_missing PostHogQueryError', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))
    const client = createPostHogEndpointClient()
    await expect(client.runEndpoint('brand_core_totals', 1, { brand_id: 'x' })).rejects.toMatchObject({
      code: 'endpoint_missing',
    })
  })
})
