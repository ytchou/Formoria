import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { workerChromiumDetector } from '../worker-chromium'

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

describe('worker-chromium detector', () => {
  it('fails on an empty render', async () => {
    const fakeFetch = async () =>
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        CURATION_WORKER_URL: 'https://worker.example.com',
        CURATION_WORKER_CONTROL_TOKEN: 'test-token',
      },
    })
    const findings = await workerChromiumDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/empty.*render|chromium/i)
    expect(findings[0].severity).toBe('high')
  })

  it('returns no findings on a non-empty render', async () => {
    const fakeFetch = async () =>
      new Response('<html><body>Hello World</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        CURATION_WORKER_URL: 'https://worker.example.com',
        CURATION_WORKER_CONTROL_TOKEN: 'test-token',
      },
    })
    const findings = await workerChromiumDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await workerChromiumDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
