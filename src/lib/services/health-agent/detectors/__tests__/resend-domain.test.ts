import { describe, expect, it, vi } from 'vitest'
import type { DetectorContext } from '../../types'
import { resendDomainDetector } from '../resend-domain'

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

describe('resend-domain detector', () => {
  it('fails when the domain is not verified', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'dom-1', name: 'formoria.com', status: 'pending', region: 'us-east-1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: { RESEND_MONITOR_API_KEY: 'test-key' },
    })
    const findings = await resendDomainDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/domain.*not.*verified|resend/i)
    expect(findings[0].severity).toBe('high')
  })

  it('returns no findings when the domain is verified', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'dom-1', name: 'formoria.com', status: 'verified', region: 'us-east-1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: { RESEND_MONITOR_API_KEY: 'test-key' },
    })
    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('does not use the transactional sending key for domain monitoring', async () => {
    const fetchFn = vi.fn()
    const ctx = makeCtx({
      fetch: fetchFn,
      env: { RESEND_API_KEY: 'send-only-key' },
    })

    const findings = await resendDomainDetector.run(ctx)

    expect(findings).toHaveLength(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
