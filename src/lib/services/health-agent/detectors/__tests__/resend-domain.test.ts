import { describe, expect, it } from 'vitest'
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
      env: { RESEND_API_KEY: 'test-key' },
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
      env: { RESEND_API_KEY: 'test-key' },
    })
    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when the key is send-only (restricted_api_key)', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          statusCode: 401,
          name: 'restricted_api_key',
          message: 'This API key is restricted to only send emails',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    const ctx = makeCtx({ fetch: fakeFetch, env: { RESEND_API_KEY: 're_send_only' } })

    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('reports the Resend error name on other API errors', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({ statusCode: 401, name: 'validation_error', message: 'API key is invalid' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    const ctx = makeCtx({ fetch: fakeFetch, env: { RESEND_API_KEY: 're_revoked' } })

    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].evidence).toEqual({ status: 401, errorName: 'validation_error' })
  })

  it('returns a finding when the API key contains non-ASCII characters', async () => {
    const ctx = makeCtx({
      env: { RESEND_API_KEY: 're_1234•rest' },
    })
    const findings = await resendDomainDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/invalid.*HTTP/i)
    expect(findings[0].severity).toBe('high')
  })

  it('uses RESEND_API_KEY for domain monitoring', async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({ data: [{ id: 'dom-1', name: 'formoria.com', status: 'verified', region: 'us-east-1' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const ctx = makeCtx({
      fetch: fakeFetch,
      env: { RESEND_API_KEY: 're_valid_key' },
    })

    const findings = await resendDomainDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
