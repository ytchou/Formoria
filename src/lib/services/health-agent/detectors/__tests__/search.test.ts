import { describe, expect, it } from 'vitest'
import { searchDetector } from '../search'
import type { DetectorContext } from '../../types'
import type { PostHogQueryClient, PostHogQueryResult } from '@/lib/adapters/posthog/query-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides?: Partial<DetectorContext>): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 60_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

function fakePostHogClient(result: PostHogQueryResult): PostHogQueryClient {
  return {
    run: async (_name: string, _query: string) => result,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search detector', () => {
  it('reports degraded share and intent-parse failure share above threshold', async () => {
    // Simulate: 100 searches, 40 degraded, 25 intent failures
    const client = fakePostHogClient({
      columns: ['total_searches', 'degraded_count', 'intent_parse_failures'],
      results: [[100, 40, 25]],
    })

    const findings = await searchDetector.run(
      ctx({ deps: { posthogClient: client } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)

    const degradedFinding = findings.find((f) =>
      f.fingerprint.includes('degraded-share'),
    )
    expect(degradedFinding).toBeDefined()

    const intentFinding = findings.find((f) =>
      f.fingerprint.includes('intent-parse-failures'),
    )
    expect(intentFinding).toBeDefined()
  })

  it('reports nothing when there were no search events', async () => {
    const client = fakePostHogClient({
      columns: ['total_searches', 'degraded_count', 'intent_parse_failures'],
      results: [[0, 0, 0]],
    })

    const findings = await searchDetector.run(
      ctx({ deps: { posthogClient: client } }),
    )
    expect(findings).toHaveLength(0)
  })
})
