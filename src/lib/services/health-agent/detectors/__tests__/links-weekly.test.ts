import { describe, expect, it, vi } from 'vitest'

import type { DetectorContext } from '../../types'
import type { LinkCheckClassResult } from '../../../link-checks/types'
import { linksWeeklyDetector, type LinksWeeklyDeps } from '../links-weekly'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    date: '2026-09-19', // Saturday — weekly day
    deadline: Date.now() + 120_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

function okResult(checked = 10): LinkCheckClassResult {
  return { checked, dead: 0, blocked: 0, findings: [] }
}

function failedResult(error: string): LinkCheckClassResult {
  return { checked: 0, dead: 0, blocked: 0, findings: [], error }
}

function deadResult(): LinkCheckClassResult {
  return {
    checked: 5,
    dead: 2,
    blocked: 1,
    findings: [
      {
        source: 'links-weekly',
        fingerprint: 'test',
        title: 'Dead links found',
        severity: 'medium',
        evidence: { deadLinks: ['https://dead.example.com'] },
        mergePolicy: 'human',
      },
    ],
  }
}

function buildDeps(
  overrides: Partial<LinksWeeklyDeps> = {},
): LinksWeeklyDeps {
  return {
    checkSocialLinks: vi.fn(async () => okResult()),
    checkBrandOtherUrls: vi.fn(async () => okResult()),
    checkStockistLinks: vi.fn(async () => okResult()),
    checkBrandChannelLinks: vi.fn(async () => okResult()),
    checkEventLinks: vi.fn(async () => okResult()),
    checkBrandImageLinks: vi.fn(async () => okResult()),
    checkCuratedProductLinks: vi.fn(async () => okResult()),
    checkMdxLinks: vi.fn(async () => okResult()),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('links-weekly detector', () => {
  it('runs all link-check classes and returns their findings', async () => {
    const deps = buildDeps({
      checkSocialLinks: vi.fn(async () => deadResult()),
    })
    const detector = linksWeeklyDetector(deps)
    const findings = await detector.run(ctx())

    // Social's finding should be included
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(deps.checkSocialLinks).toHaveBeenCalled()
    expect(deps.checkBrandOtherUrls).toHaveBeenCalled()
    expect(deps.checkCuratedProductLinks).toHaveBeenCalled()
    expect(deps.checkMdxLinks).toHaveBeenCalled()
  })

  it('reports a detector failure for a class that read zero rows', async () => {
    const deps = buildDeps({
      checkSocialLinks: vi.fn(async () =>
        failedResult('zero rows from brands'),
      ),
    })
    const detector = linksWeeklyDetector(deps)
    const findings = await detector.run(ctx())

    const failure = findings.find((f) =>
      f.fingerprint.includes('class-failure'),
    )
    expect(failure).toBeDefined()
    expect(failure!.title).toContain('social')
  })

  it('never throws — a class error becomes a finding', async () => {
    const deps = buildDeps({
      checkBrandOtherUrls: vi.fn(async () => {
        throw new Error('unexpected DB error')
      }),
    })
    const detector = linksWeeklyDetector(deps)

    // Must not throw
    const findings = await detector.run(ctx())
    const failure = findings.find((f) =>
      f.fingerprint.includes('class-failure'),
    )
    expect(failure).toBeDefined()
    expect(failure!.evidence.error).toContain('unexpected DB error')
  })

  it('collects findings from all classes', async () => {
    const deps = buildDeps({
      checkSocialLinks: vi.fn(async () => deadResult()),
      checkEventLinks: vi.fn(async () => deadResult()),
    })
    const detector = linksWeeklyDetector(deps)
    const findings = await detector.run(ctx())

    // At least the two dead-result findings
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it('has schedule weekly and source links-weekly', () => {
    const detector = linksWeeklyDetector(buildDeps())
    expect(detector.schedule).toBe('weekly')
    expect(detector.source).toBe('links-weekly')
  })
})
