import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { langfuseDetector } from '../langfuse'

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

const BASE_ENV = {
  LANGFUSE_PUBLIC_KEY: 'pk-test',
  LANGFUSE_SECRET_KEY: 'sk-test',
  LANGFUSE_HOST: 'https://cloud.langfuse.com',
}

describe('langfuse detector', () => {
  it('fails when no trace arrived in 24 hours', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/public/traces')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Prompt resolution succeeds
      return new Response(JSON.stringify({ name: 'descriptions', version: 1, prompt: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: BASE_ENV,
      snapshotPromptNames: ['descriptions'],
    })
    const findings = await langfuseDetector.run(ctx)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.some((f) => f.title.match(/no.*trace/i))).toBe(true)
  })

  it('fails when a snapshot prompt name does not resolve', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/public/traces')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'trace-1', timestamp: new Date().toISOString() }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // Prompt resolution fails
      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: BASE_ENV,
      snapshotPromptNames: ['nonexistent-prompt'],
    })
    const findings = await langfuseDetector.run(ctx)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.some((f) => f.title.match(/prompt.*resolve/i))).toBe(true)
  })

  it('returns no findings when traces exist and all prompts resolve', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/public/traces')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'trace-1', timestamp: new Date().toISOString() }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ name: 'descriptions', version: 1, prompt: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: BASE_ENV,
      snapshotPromptNames: ['descriptions'],
    })
    const findings = await langfuseDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await langfuseDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
