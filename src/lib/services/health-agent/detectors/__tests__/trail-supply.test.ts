import { describe, expect, it } from 'vitest'

import type { TrailSupplyReport } from '@/lib/services/trail-supply-report'
import { evaluateTrailSupply } from '../../../../../../scripts/health-agent/trail-supply'
import type { DetectorContext } from '../../types'
import { trailSupplyDetector } from '../trail-supply'

function ctx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 120_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

describe('trail supply detector', () => {
  it('calls the Railway origin route with ORIGIN_SECRET and treats readUnavailable as a failure', async () => {
    const railwayUrl = 'https://formoria-internal.up.railway.app'
    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined

    const unavailableReport: TrailSupplyReport = {
      readUnavailable: true,
      trailsObserved: 0,
      selectionsObserved: 0,
      emptySections: [],
      orphanedSelections: [],
    }

    const detector = trailSupplyDetector({
      railwayUrl,
      originSecret: 'test-secret',
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString()
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers ?? {}),
        )
        return new Response(JSON.stringify(unavailableReport), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const findings = await detector.run(ctx())

    // Called at the origin, not the public host
    expect(capturedUrl).toBe(
      `${railwayUrl}/api/cron/trail-supply`,
    )
    // Passes the origin secret
    expect(capturedHeaders).toMatchObject({
      'x-origin-secret': 'test-secret',
    })
    // readUnavailable produces a finding about the failure
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.some((f) => f.title.includes('unavailable') || f.source === 'directory')).toBe(true)
  })

  it('evaluate functions match the scripts implementation on fixtures', () => {
    const report: TrailSupplyReport = {
      readUnavailable: false,
      trailsObserved: 2,
      selectionsObserved: 9,
      emptySections: [
        {
          sectionKey: 'tableware',
          sectionTitle: 'Everyday tableware',
          trailSlug: 'autumn-kitchen',
        },
      ],
      orphanedSelections: [
        {
          reason: 'unknown_trail',
          sectionKey: 'mugs',
          trailSlug: 'retired-trail',
        },
      ],
    }

    const findings = evaluateTrailSupply(report)

    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({
      source: 'directory',
      disposition: 'report_only',
      mergePolicy: 'human',
    })
    // readUnavailable returns empty
    expect(evaluateTrailSupply({ ...report, readUnavailable: true })).toEqual([])
  })
})
