import { describe, expect, it } from 'vitest'
import type { DetectorName, HealthSource } from '@/lib/constants/health-detectors'
import { runDetectors } from '../runner'
import type { Detector } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetector(
  overrides: Partial<Detector> & { name: DetectorName; source: HealthSource },
): Detector {
  return {
    schedule: 'nightly',
    severity: 'medium',
    run: async () => [],
    ...overrides,
  }
}

/** A nightly date that is NOT Saturday (the weekly run day). */
function nightlyDate(): string {
  // Find a Wednesday (weekday 3) in September 2026
  // 2026-09-16 is a Wednesday
  return '2026-09-16'
}


describe('runDetectors', () => {
  it('a throwing detector becomes a detector-failure finding', async () => {
    const registry: Detector[] = [
      makeDetector({
        name: 'brand-invariants',
        source: 'directory',
        run: async () => {
          throw new Error('db connection refused')
        },
      }),
    ]

    const { results, completedSources } = await runDetectors(registry, {
      now: nightlyDate(),
      concurrency: 2,
      dryRun: false,
      deps: {},
    })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(results[0].error).toBe('db connection refused')
    expect(results[0].findings).toHaveLength(1)
    expect(results[0].findings[0].fingerprint).toBe(
      'agent:detector-failure:brand-invariants',
    )
    // The failed detector's source must NOT be in completedSources
    expect(completedSources).not.toContain('directory')
  })

  it('a detector exceeding its soft deadline is reported failed and siblings still complete', async () => {
    const registry: Detector[] = [
      makeDetector({
        name: 'brand-invariants',
        source: 'directory',
        run: async (ctx) => {
          // Simulate exceeding deadline by waiting for the signal
          return new Promise((_, reject) => {
            ctx.signal.addEventListener('abort', () => {
              reject(new Error('The operation was aborted'))
            })
          })
        },
      }),
      makeDetector({
        name: 'brand-review',
        source: 'directory',
        run: async () => [
          {
            source: 'directory',
            fingerprint: 'directory:brand-review:test',
            title: 'Test finding',
            severity: 'low' as const,
            evidence: {},
            mergePolicy: 'human' as const,
          },
        ],
      }),
    ]

    const { results } = await runDetectors(registry, {
      now: nightlyDate(),
      concurrency: 10,
      dryRun: false,
      deps: {},
      detectorDeadlineMs: 50, // very short deadline
    })

    expect(results).toHaveLength(2)
    const timedOut = results.find((r) => r.name === 'brand-invariants')
    const sibling = results.find((r) => r.name === 'brand-review')

    expect(timedOut?.status).toBe('failed')
    expect(sibling?.status).toBe('ok')
    expect(sibling?.findings).toHaveLength(1)
  })

  it('a source is completed only when every due detector in it succeeded', async () => {
    const registry: Detector[] = [
      makeDetector({
        name: 'brand-invariants',
        source: 'directory',
        run: async () => [],
      }),
      makeDetector({
        name: 'brand-review',
        source: 'directory',
        run: async () => {
          throw new Error('review failed')
        },
      }),
      makeDetector({
        name: 'sentry-triage',
        source: 'sentry',
        run: async () => [],
      }),
    ]

    const { completedSources } = await runDetectors(registry, {
      now: nightlyDate(),
      concurrency: 10,
      dryRun: false,
      deps: {},
    })

    // directory has one failure, so it's NOT completed
    expect(completedSources).not.toContain('directory')
    // sentry has all detectors succeeded
    expect(completedSources).toContain('sentry')
  })

  it('weekly detectors are skipped and their source not completed on other nights', async () => {
    const registry: Detector[] = [
      makeDetector({
        name: 'social',
        source: 'links-weekly',
        schedule: 'weekly',
        run: async () => [],
      }),
      makeDetector({
        name: 'sentry-triage',
        source: 'sentry',
        schedule: 'nightly',
        run: async () => [],
      }),
    ]

    const { results, completedSources } = await runDetectors(registry, {
      now: nightlyDate(), // Not a Saturday
      concurrency: 10,
      dryRun: false,
      deps: {},
    })

    // The weekly detector should not have been run
    expect(results.find((r) => r.name === 'social')).toBeUndefined()
    // links-weekly source should NOT be in completedSources
    expect(completedSources).not.toContain('links-weekly')
    // But sentry should be completed
    expect(completedSources).toContain('sentry')
  })
})
