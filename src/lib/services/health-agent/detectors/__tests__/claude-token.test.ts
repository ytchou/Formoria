import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { claudeTokenDetector } from '../claude-token'

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

describe('claude-token detector', () => {
  it('warns 30 days before one year from CLAUDE_TOKEN_ISSUED_AT', async () => {
    // Token issued on 2025-10-18 → expires 2026-10-18 → 30-day warning from 2026-09-18
    // Current date is 2026-09-17, which is within the 30-day window
    const ctx = makeCtx({
      env: { CLAUDE_TOKEN_ISSUED_AT: '2025-10-05' },
      now: () => new Date('2026-09-17T00:00:00+08:00').getTime(),
    })
    const findings = await claudeTokenDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].title).toMatch(/claude.*token.*expir/i)
  })

  it('fails when CLAUDE_TOKEN_ISSUED_AT is unset', async () => {
    const ctx = makeCtx({
      env: {},
      now: () => new Date('2026-09-17T00:00:00+08:00').getTime(),
    })
    const findings = await claudeTokenDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].title).toMatch(/claude.*token.*not.*set|not.*configured/i)
  })

  it('returns no findings when the token is fresh', async () => {
    // Token issued 2026-06-01 → expires 2027-06-01, plenty of time
    const ctx = makeCtx({
      env: { CLAUDE_TOKEN_ISSUED_AT: '2026-06-01' },
      now: () => new Date('2026-09-17T00:00:00+08:00').getTime(),
    })
    const findings = await claudeTokenDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('warns with high severity when the token is already expired', async () => {
    // Token issued 2025-06-01 → expired 2026-06-01
    const ctx = makeCtx({
      env: { CLAUDE_TOKEN_ISSUED_AT: '2025-06-01' },
      now: () => new Date('2026-09-17T00:00:00+08:00').getTime(),
    })
    const findings = await claudeTokenDetector.run(ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })
})
