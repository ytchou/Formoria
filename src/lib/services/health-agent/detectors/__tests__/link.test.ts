import { describe, expect, it, vi } from 'vitest'

import type { DetectorContext } from '../../types'
import { linkDetector } from '../link'

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

describe('link detector', () => {
  it('runs link-health then link-cleanup, and skips cleanup when link-health failed', async () => {
    const calls: string[] = []
    const runLinkHealthCheck = vi.fn(async () => {
      calls.push('link-health')
      throw new Error('link-health boom')
    })
    const cleanupDeadLinks = vi.fn(async () => {
      calls.push('link-cleanup')
      return { applied: [], skipped: [], scanned: 0 }
    })

    const detector = linkDetector({
      runLinkHealthCheck,
      cleanupDeadLinks,
    })

    const findings = await detector.run(ctx())

    expect(calls).toEqual(['link-health'])
    expect(runLinkHealthCheck).toHaveBeenCalledTimes(1)
    expect(cleanupDeadLinks).not.toHaveBeenCalled()
    // The detector never throws, but returns an error-level finding
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]).toMatchObject({
      source: 'link',
      severity: 'high',
    })
  })

  it('runs both link-health and link-cleanup on success', async () => {
    const calls: string[] = []
    const runLinkHealthCheck = vi.fn(async () => {
      calls.push('link-health')
      return {
        checked: 10,
        ok: 9,
        broken: 1,
        blocked: 0,
        cleanupRequired: [],
        heroBroken: [],
        heroExternal: [],
        failingRows: [],
        severity: 'ok' as const,
      }
    })
    const cleanupDeadLinks = vi.fn(async () => {
      calls.push('link-cleanup')
      return { applied: [], skipped: [], scanned: 0 }
    })

    const detector = linkDetector({
      runLinkHealthCheck,
      cleanupDeadLinks,
    })

    const findings = await detector.run(ctx())

    expect(calls).toEqual(['link-health', 'link-cleanup'])
    expect(runLinkHealthCheck).toHaveBeenCalledTimes(1)
    expect(cleanupDeadLinks).toHaveBeenCalledTimes(1)
    expect(findings).toEqual([])
  })

  it('passes a railway run identity accepted by SAFE_RUN_IDENTITY', async () => {
    let capturedIdentity: string | undefined
    const SAFE_RUN_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/

    const runLinkHealthCheck = vi.fn(async (options: Record<string, unknown>) => {
      capturedIdentity = options.runIdentity as string
      return {
        checked: 0,
        ok: 0,
        broken: 0,
        blocked: 0,
        cleanupRequired: [],
        heroBroken: [],
        heroExternal: [],
        failingRows: [],
        severity: 'ok' as const,
      }
    })
    const cleanupDeadLinks = vi.fn(async () => ({
      applied: [],
      skipped: [],
      scanned: 0,
    }))

    const detector = linkDetector({
      runLinkHealthCheck,
      cleanupDeadLinks,
    })

    await detector.run(ctx())

    expect(capturedIdentity).toBeDefined()
    expect(SAFE_RUN_IDENTITY.test(capturedIdentity!)).toBe(true)
  })
})
