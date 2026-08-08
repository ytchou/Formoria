import { toStoryDate } from '@/components/stories/story-date'

/**
 * Event dates share the stories' Invalid-Date guard rather than growing a
 * second copy of it: `toStoryDate` is the one place that turns an unusable
 * date string into `null` instead of letting an Invalid Date reach a formatter
 * (`Intl.DateTimeFormat().format()` throws `RangeError: Invalid time value`,
 * and `String(invalidDate)` renders the literal text "Invalid Date" onto a
 * card). Nothing here formats through `Intl`: `starts_on` / `ends_on` are
 * Taipei calendar days that must read identically in zh-TW and en, and an
 * `en-US` formatter would reorder them to `08/06/2026`.
 */

type CalendarParts = { year: string; month: string; day: string }

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * En dash, the typographic range separator — not a hyphen. Padded with a
 * space on both sides so the range reads with the same rhythm as the authored
 * schedule note beside it (`8/6(weekday) – 8/7(weekday) 10:00 – 18:00`, with
 * the weekday written in Han); an unspaced
 * dash between two slash-heavy dates ran the two ends together.
 */
const RANGE_SEPARATOR = ' – '

function toCalendarParts(value: string | null | undefined): CalendarParts | null {
  if (!value) return null

  const trimmed = value.trim()

  // `'YYYY-MM-DD'` is the ONLY accepted shape, and its calendar fields are read
  // straight off the string. There is deliberately no fallback that normalizes
  // another shape through a `Date`: `new Date(x).toISOString()` re-anchors the
  // value to UTC, so `'2026-08-06T00:00:00+08:00'` (Taipei midnight) and a
  // hand-typed `'2026/08/06'` on a UTC+8 server both come back as 2026-08-05 —
  // the one-day-early render this module exists to prevent. Anything else is
  // refused here and degrades to `''` at the call site, which is visibly wrong
  // rather than silently wrong.
  const direct = ISO_DATE_PATTERN.exec(trimmed)
  if (!direct) return null

  // The shared Invalid-Date gate, still the single definition of "unusable
  // date" across stories and events: it rejects the values V8 refuses outright,
  // such as the month overflow in `'2026-13-01'`.
  if (!toStoryDate(trimmed)) return null

  // …but it cannot be the whole day check: V8 ROLLS OVER an out-of-range day
  // instead of failing, so `new Date('2026-02-30')` is a perfectly valid Mar 2
  // and would have rendered as `2026/02/30`. The round trip below is the only
  // thing that proves the day exists — same shape as the `calendarDate` helper
  // in `scripts/seed-events.ts`, mirrored rather than imported because that is
  // a `tsx` node script and this module ships to the client. Note the integers
  // come from the already-matched groups: the raw string is never re-parsed.
  const year = Number(direct[1])
  const month = Number(direct[2])
  const day = Number(direct[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }

  return { year: direct[1], month: direct[2], day: direct[3] }
}

function isSameDay(a: CalendarParts, b: CalendarParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/**
 * Display range for an event, or `''` when the start date is unusable.
 *
 * Returning `''` rather than `null` keeps every call site a bare
 * `{dateLabel ? … : null}` — the same falsy check both branches already use.
 *
 * - single day → `2026/08/06`
 * - within one month → `2026/08/06 – 08/16` (year stated once)
 * - anything wider → `2026/08/01 – 2026/10/31`
 */
export function formatEventDateRange(
  startsOn: string | null | undefined,
  endsOn?: string | null,
): string {
  const start = toCalendarParts(startsOn)
  if (!start) return ''

  const startLabel = `${start.year}/${start.month}/${start.day}`

  // An unusable `endsOn` degrades to the start date alone: one bad column must
  // not blank the date line that the good column can still fill.
  const end = toCalendarParts(endsOn)
  if (!end || isSameDay(start, end)) return startLabel

  if (start.year === end.year && start.month === end.month) {
    return `${startLabel}${RANGE_SEPARATOR}${end.month}/${end.day}`
  }

  return `${startLabel}${RANGE_SEPARATOR}${end.year}/${end.month}/${end.day}`
}
