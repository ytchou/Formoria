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

  it('formatEventDateRange_rejects_non_calendar_date_shapes', () => {
    // Anything that is not a bare `'YYYY-MM-DD'` calendar day is refused rather
    // than normalized through a `Date`. Routing these through
    // `new Date(x).toISOString()` is what produced the very Taipei→UTC
    // day-shift this module exists to prevent: an offset-bearing timestamp at
    // Taipei midnight, and a slash-separated string parsed in a UTC+8 server
    // TZ, both serialize back as the PREVIOUS day.
    for (const shifty of [
      '2026-08-06T00:00:00+08:00',
      '2026-08-06T00:00:00.000+08:00',
      '2026/08/06',
      '2026-8-6',
      '  2026-08-06T00:00:00+08:00  ',
    ]) {
      const result = formatEventDateRange(shifty, shifty)
      expect(result).toBe('')
      // The failure mode is a silent off-by-one, so assert the wrong day is
      // never rendered — not merely that the result is falsy.
      expect(result).not.toContain('08/05')
    }
  })

  it('formatEventDateRange_rejects_iso_shaped_impossible_days', () => {
    // The shared `toStoryDate` guard still earns its keep: these match the
    // `YYYY-MM-DD` pattern but are not real days, and reading the fields
    // straight off the string would render `2026/02/30`.
    expect(formatEventDateRange('2026-02-30')).toBe('')
    expect(formatEventDateRange('2026-13-01')).toBe('')

    // A bad `endsOn` of that shape still degrades to the start date alone.
    expect(formatEventDateRange('2026-08-06', '2026-02-30')).toBe('2026/08/06')
  })

  it('formatEventDateRange_tolerates_surrounding_whitespace', () => {
    expect(formatEventDateRange(' 2026-08-06 ', ' 2026-08-16 ')).toBe(
      '2026/08/06–08/16',
    )
  })
})
