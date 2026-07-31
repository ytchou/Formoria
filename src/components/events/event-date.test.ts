import { describe, expect, it } from 'vitest'

import { formatEventDateRange } from './event-date'

/**
 * The contract is a fixed, locale-independent shape (`YYYY/MM/DD`), not an
 * `Intl` rendering: an event's `starts_on` / `ends_on` are Taipei calendar days
 * and must read identically in both locales, so nothing here goes through
 * `Intl.DateTimeFormat` (which would emit `08/06/2026` under `en-US`).
 */
describe('formatEventDateRange', () => {
  it('formatEventDateRange_same_month', () => {
    // Same year AND month: the tail drops the year only, keeping month/day so
    // the range still reads as two dates rather than a day number.
    expect(formatEventDateRange('2026-08-06', '2026-08-16')).toBe('2026/08/06–08/16')
  })

  it('formatEventDateRange_cross_month', () => {
    expect(formatEventDateRange('2026-08-01', '2026-10-31')).toBe('2026/08/01–2026/10/31')
  })

  it('formatEventDateRange_same_day', () => {
    // A one-day event renders once. Both spellings of "one day" collapse: an
    // explicit identical `endsOn`, and a missing one.
    expect(formatEventDateRange('2026-08-06', '2026-08-06')).toBe('2026/08/06')
    expect(formatEventDateRange('2026-08-06', null)).toBe('2026/08/06')
    expect(formatEventDateRange('2026-08-06')).toBe('2026/08/06')
  })

  it('formatEventDateRange_invalid_input', () => {
    // `new Date('')` and `new Date('nope')` are Invalid Dates. The failure mode
    // guarded against is a card rendering the literal string "Invalid Date", so
    // that string is asserted against directly, not just the empty result.
    for (const bad of ['', '   ', 'nope', 'not-a-date', null, undefined]) {
      const result = formatEventDateRange(bad, '2026-08-16')
      expect(result).toBe('')
      expect(result).not.toContain('Invalid Date')
    }

    // An unusable `endsOn` degrades to the start date alone rather than
    // poisoning the whole range.
    expect(formatEventDateRange('2026-08-06', 'not-a-date')).toBe('2026/08/06')
  })
})
