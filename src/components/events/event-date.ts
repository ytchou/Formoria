import { toStoryDate, toStoryIsoDate } from '@/components/stories/story-date'

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

/** En dash, the typographic range separator — not a hyphen. */
const RANGE_SEPARATOR = '–'

function toCalendarParts(value: string | null | undefined): CalendarParts | null {
  if (!value) return null
  // The single Invalid-Date gate. Everything below this line is already known
  // to be a parseable date.
  if (!toStoryDate(value)) return null

  const trimmed = value.trim()

  // The service layer documents these columns as `'YYYY-MM-DD'` and never
  // parses them into a `Date`, so the common path reads the calendar fields
  // straight off the string. Going through a `Date` here would re-interpret a
  // Taipei calendar day as UTC midnight and could shift it by one.
  const direct = ISO_DATE_PATTERN.exec(trimmed)
  if (direct) {
    return { year: direct[1], month: direct[2], day: direct[3] }
  }

  // Parseable but not ISO-shaped (a full timestamp, a hand-typed `2026/08/06`).
  // Normalized through the shared ISO serializer rather than re-deriving
  // calendar fields — one definition of "the ISO form of this date".
  const iso = toStoryIsoDate(trimmed)
  const normalized = iso ? ISO_DATE_PATTERN.exec(iso.slice(0, 10)) : null
  if (!normalized) return null

  return { year: normalized[1], month: normalized[2], day: normalized[3] }
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
 * - within one month → `2026/08/06–08/16` (year stated once)
 * - anything wider → `2026/08/01–2026/10/31`
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
