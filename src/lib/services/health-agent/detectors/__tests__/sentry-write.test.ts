import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { sentryWriteDetector } from '../sentry-write'

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

describe('sentry-write detector', () => {
  it('fails when the token cannot write', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ detail: 'You do not have permission to perform this action.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SENTRY_AUTH_TOKEN: 'test-sentry-token',
        SENTRY_BASE_URL: 'https://sentry.io',
        SENTRY_ORGANIZATION: 'formoria',
        SENTRY_PROJECT: 'formoria-web',
      },
    })
    const findings = await sentryWriteDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/sentry.*write|permission/i)
    expect(findings[0].severity).toBe('high')
  })

  it('returns no findings when the token has write access', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ scopes: ['project:write', 'event:write'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SENTRY_AUTH_TOKEN: 'test-sentry-token',
        SENTRY_BASE_URL: 'https://sentry.io',
        SENTRY_ORGANIZATION: 'formoria',
        SENTRY_PROJECT: 'formoria-web',
      },
    })
    const findings = await sentryWriteDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await sentryWriteDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
