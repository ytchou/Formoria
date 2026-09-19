import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { sentryCaptureDetector } from '../sentry-capture'

function makeCtx(
  deps: Record<string, unknown> = {},
): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps,
  }
}

describe('sentry-capture detector', () => {
  it('triggers the canary with a fresh token and fails if no matching event appears before the deadline', async () => {
    const requests: {
      url: string
      method?: string
      headers?: HeadersInit
      body?: BodyInit | null
    }[] = []
    const fakeFetch = async (url: string, init?: RequestInit) => {
      requests.push({
        url: url as string,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      })
      if (typeof url === 'string' && url.includes('/api/internal/sentry-canary')) {
        // The route deliberately returns 500 after capturing the canary.
        return new Response(JSON.stringify({ ok: true }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Sentry issues API returns no matching events
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SENTRY_AUTH_TOKEN: 'test-sentry-token',
        SENTRY_BASE_URL: 'https://sentry.io',
        SENTRY_ORGANIZATION: 'formoria',
        SENTRY_PROJECT: 'formoria-web',
        FORMORIA_RAILWAY_URL: 'https://formoria.railway.internal',
        ORIGIN_SECRET: 'machine-caller-secret',
        CF_ORIGIN_SECRET: 'edge-secret',
      },
      // Override the poll to finish immediately without waiting
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    })
    const findings = await sentryCaptureDetector.run(ctx)

    // Should have triggered the canary at the Railway origin
    expect(requests.some((r) => r.url.includes('formoria.railway.internal'))).toBe(true)
    const canaryRequest = requests.find((r) =>
      r.url.includes('/api/internal/sentry-canary'),
    )
    expect(canaryRequest?.method).toBe('POST')
    expect(new Headers(canaryRequest?.headers).get('x-origin-verify')).toBe(
      'machine-caller-secret',
    )
    expect(new Headers(canaryRequest?.headers).get('content-type')).toBe(
      'application/json',
    )
    const canaryBody = JSON.parse(String(canaryRequest?.body)) as {
      token: string
    }
    expect(canaryBody).toMatchObject({
      token: expect.any(String),
    })
    const pollRequest = requests.find((r) => r.url.includes('/issues/'))
    expect(new URL(pollRequest!.url).searchParams.get('query')).toBe(
      `health_canary_token:${canaryBody.token}`,
    )
    // Should fail because no matching event appeared
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/canary|sentry.*capture/i)
  })

  it('returns no findings when the canary event is found', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/internal/sentry-canary')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Sentry issues API returns a matching event
      return new Response(
        JSON.stringify([{ id: 'issue-1', title: 'HealthCanary', metadata: {} }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SENTRY_AUTH_TOKEN: 'test-sentry-token',
        SENTRY_BASE_URL: 'https://sentry.io',
        SENTRY_ORGANIZATION: 'formoria',
        SENTRY_PROJECT: 'formoria-web',
        FORMORIA_RAILWAY_URL: 'https://formoria.railway.internal',
        ORIGIN_SECRET: 'machine-caller-secret',
      },
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    })
    const findings = await sentryCaptureDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await sentryCaptureDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('prefers the dedicated read token when both token variables are configured', async () => {
    const requests: Array<{ url: string; headers?: HeadersInit }> = []
    const fakeFetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, headers: init?.headers })
      if (url.includes('/api/internal/sentry-canary')) {
        return new Response(null, { status: 500 })
      }
      return Response.json([{ id: 'canary-group' }])
    }

    const findings = await sentryCaptureDetector.run(makeCtx({
      fetch: fakeFetch,
      env: {
        SENTRY_READ_TOKEN: 'dedicated-read-token',
        SENTRY_AUTH_TOKEN: 'stale-auth-token',
        SENTRY_ORGANIZATION: 'formoria',
        SENTRY_PROJECT: 'formoria',
        FORMORIA_RAILWAY_URL: 'https://formoria.railway.internal',
      },
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    }))

    expect(findings).toEqual([])
    const poll = requests.find((request) => request.url.includes('/issues/'))
    expect(new Headers(poll?.headers).get('authorization')).toBe(
      'Bearer dedicated-read-token',
    )
  })
})
