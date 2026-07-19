import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface ScriptContract {
  getDateWindows(today: string): {
    latestCompleteDate: string
    current: { startDate: string; endDate: string }
    prior: { startDate: string; endDate: string }
    trend: { startDate: string; endDate: string }
  }
  protectedPathPattern: string
  enumerateIsoDates(startDate: string, endDate: string): string[]
}

function loadContract(): ScriptContract {
  const source = readFileSync('docs/routines/growth-pulse-apps-script.js', 'utf8')
  const context: Record<string, unknown> = {}
  runInNewContext(
    `${source}\nglobalThis.__contract = { getDateWindows, enumerateIsoDates, protectedPathPattern: PROTECTED_PATH_PATTERN };`,
    context,
  )
  return context.__contract as ScriptContract
}

describe('Growth Pulse Apps Script contract', () => {
  it('uses complete T-2 current, prior, and 28-day windows', () => {
    const { getDateWindows } = loadContract()

    expect(getDateWindows('2026-07-19')).toEqual({
      latestCompleteDate: '2026-07-17',
      previousCompleteDate: '2026-07-16',
      sameWeekdayPreviousDate: '2026-07-10',
      current: { startDate: '2026-07-11', endDate: '2026-07-17' },
      prior: { startDate: '2026-07-04', endDate: '2026-07-10' },
      trend: { startDate: '2026-06-20', endDate: '2026-07-17' },
    })
  })

  it('excludes protected routes with or without locale prefixes', () => {
    const { protectedPathPattern } = loadContract()
    const pattern = new RegExp(protectedPathPattern)

    expect(['/admin', '/zh-TW/dashboard/brands', '/en/auth/callback']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(pattern),
        expect.stringMatching(pattern),
        expect.stringMatching(pattern),
      ]),
    )
    expect('/zh-TW/brands/formoria').not.toMatch(pattern)
  })

  it('produces every day in the 28-day trend window', () => {
    const { enumerateIsoDates } = loadContract()
    const dates = enumerateIsoDates('2026-06-20', '2026-07-17')

    expect(dates).toHaveLength(28)
    expect(dates.at(0)).toBe('2026-06-20')
    expect(dates.at(-1)).toBe('2026-07-17')
  })

  it('keeps the envelope at version 1 and adds the executive schema', () => {
    const prompt = readFileSync('docs/routines/formoria-health-prompt.md', 'utf8')

    expect(prompt).toContain('"version": 1')
    expect(prompt).toContain('"executive": {')
    expect(prompt).toContain('"schema_version": 1')
    expect(prompt).toContain('"daily": [')
  })
})
