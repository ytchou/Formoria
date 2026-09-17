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
    const requests: { url: string }[] = []
    const fakeFetch = async (url: string) => {
      requests.push({ url: url as string })
      if (typeof url === 'string' && url.includes('/api/cron/health-canary')) {
        // Canary trigger succeeds
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
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
        CF_ORIGIN_SECRET: 'origin-secret',
      },
      // Override the poll to finish immediately without waiting
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    })
    const findings = await sentryCaptureDetector.run(ctx)

    // Should have triggered the canary at the Railway origin
    expect(requests.some((r) => r.url.includes('formoria.railway.internal'))).toBe(true)
    // Should fail because no matching event appeared
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/canary|sentry.*capture/i)
  })

  it('returns no findings when the canary event is found', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/cron/health-canary')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
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
        CF_ORIGIN_SECRET: 'origin-secret',
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
})
