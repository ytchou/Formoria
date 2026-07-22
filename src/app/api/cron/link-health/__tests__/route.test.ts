import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/link-health', () => ({
  runLinkHealthCheck: vi.fn(),
}))

import { runLinkHealthCheck } from '@/lib/services/link-health'

const summary = {
  checked: 5,
  ok: 4,
  broken: 1,
  blocked: 0,
  cleanupRequired: [],
  heroBroken: [],
  heroExternal: [],
  failingRows: [],
  severity: 'warning' as const,
}

function makeRequest(body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/link-health', {
    method: 'POST',
    headers: {
      'x-origin-verify': 'test-secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/cron/link-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ORIGIN_SECRET', 'test-secret')
    vi.mocked(runLinkHealthCheck).mockResolvedValue(summary)
  })

  it('returns 401 without valid x-origin-verify header', async () => {
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
    })

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('returns 401 with wrong x-origin-verify header', async () => {
    const { POST } = await import('../route')
    const req = makeRequest(undefined, { 'x-origin-verify': 'wrong-secret' })

    const response = await POST(req)

    expect(response.status).toBe(401)
  })

  it('requires application/json for authenticated requests', async () => {
    const { POST } = await import('../route')

    const response = await POST(
      makeRequest(undefined, { 'content-type': 'text/plain' }),
    )

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'Unsupported media type' })
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('accepts JSON media type parameters and passes typed live options', async () => {
    const { POST } = await import('../route')
    const req = makeRequest(
      {
        dry_run: false,
        run_identity: 'github-link-health:2026-07-22',
        workflow_attempt: 1,
      },
      { 'content-type': 'application/json; charset=utf-8' },
    )

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(runLinkHealthCheck).toHaveBeenCalledWith({
      dryRun: false,
      runIdentity: 'github-link-health:2026-07-22',
      workflowAttempt: 1,
    })
    expect(await response.json()).toMatchObject({
      checked: 5,
      ok: 4,
      broken: 1,
    })
  })

  it('allows dry-run without a run identity', async () => {
    const { POST } = await import('../route')

    const response = await POST(makeRequest({ dry_run: true }))

    expect(response.status).toBe(200)
    expect(runLinkHealthCheck).toHaveBeenCalledWith({
      dryRun: true,
      runIdentity: undefined,
      workflowAttempt: undefined,
    })
  })

  it('rejects a live request without a stable run identity', async () => {
    const { POST } = await import('../route')

    const response = await POST(makeRequest({ dry_run: false }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid request' })
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and invalid field types with generic 400 responses', async () => {
    const { POST } = await import('../route')
    const malformed = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
      headers: {
        'x-origin-verify': 'test-secret',
        'content-type': 'application/json',
      },
      body: '{',
    })

    const malformedResponse = await POST(malformed)
    expect(malformedResponse.status).toBe(400)
    expect(await malformedResponse.json()).toEqual({
      error: 'Invalid request',
    })

    const invalidResponse = await POST(
      makeRequest({
        dry_run: 'yes',
        run_identity: 'github-link-health:2026-07-22',
      }),
    )
    expect(invalidResponse.status).toBe(400)
    expect(await invalidResponse.json()).toEqual({ error: 'Invalid request' })
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('rejects unsafe or unbounded identity strings', async () => {
    const { POST } = await import('../route')

    const unsafe = await POST(
      makeRequest({ run_identity: 'run id', workflow_attempt: '1' }),
    )
    const tooLong = await POST(makeRequest({ run_identity: 'a'.repeat(129) }))
    const stringAttempt = await POST(
      makeRequest({
        run_identity: 'safe-run',
        workflow_attempt: '1',
      }),
    )
    const zeroAttempt = await POST(
      makeRequest({ run_identity: 'safe-run', workflow_attempt: 0 }),
    )
    const fractionalAttempt = await POST(
      makeRequest({ run_identity: 'safe-run', workflow_attempt: 1.5 }),
    )

    expect(unsafe.status).toBe(400)
    expect(tooLong.status).toBe(400)
    expect(stringAttempt.status).toBe(400)
    expect(zeroAttempt.status).toBe(400)
    expect(fractionalAttempt.status).toBe(400)
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('rejects request bodies above the explicit byte limit with 413', async () => {
    const { POST } = await import('../route')
    const response = await POST(
      makeRequest({
        run_identity: 'a'.repeat(4100),
      }),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Request body too large' })
    expect(runLinkHealthCheck).not.toHaveBeenCalled()
  })

  it('returns a generic 500 without exposing service exceptions', async () => {
    vi.mocked(runLinkHealthCheck).mockRejectedValue(new Error('DB unavailable'))
    const { POST } = await import('../route')

    const response = await POST(makeRequest({ run_identity: 'safe-run' }))
    const responseBody = await response.json()

    expect(response.status).toBe(500)
    expect(responseBody).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(responseBody)).not.toContain('DB unavailable')
  })
})
