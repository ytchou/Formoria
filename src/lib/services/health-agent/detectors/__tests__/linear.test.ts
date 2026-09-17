import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { linearDetector } from '../linear'

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

describe('linear detector', () => {
  it('fails on a rejected viewer query', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Authentication required' }] }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: { LINEAR_API_KEY: 'lin_api_test_key' },
    })
    const findings = await linearDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].title).toMatch(/linear/i)
  })

  it('returns no findings on a successful viewer query', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ data: { viewer: { id: 'user-123' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: { LINEAR_API_KEY: 'lin_api_test_key' },
    })
    const findings = await linearDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when LINEAR_API_KEY is not set (unconfigured)', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await linearDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
