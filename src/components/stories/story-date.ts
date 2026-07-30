import { dateLocale } from '@/i18n/locale-preference'

/**
 * Story frontmatter dates are author-typed strings, and `parseStoryFile`
 * defaults a missing `publishedAt` to `''`. `new Date('')` is an Invalid Date,
 * and `Intl.DateTimeFormat().format()` on one throws `RangeError: Invalid time
 * value` — thrown from a server component that would blank the entire route
 * rather than degrade the one undated story. Everything that reads a story date
 * goes through here so the hub and the detail page fail the same way: they drop
 * the date, not the page.
 */
export function toStoryDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Display date for a story card, or `null` when the frontmatter has no usable date. */
export function formatStoryDate(
  value: string | null | undefined,
  locale: string,
): string | null {
  const date = toStoryDate(value)
  if (!date) return null

  return new Intl.DateTimeFormat(dateLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * ISO-8601 form for schema.org `datePublished` / `dateModified`, or `null` when
 * the value is unusable. schema.org date properties must be ISO-8601; emitting
 * the raw frontmatter string would ship `datePublished: ""` (or a JS `Date`
 * `toString()` such as `"Mon Jun 15 2026 …"` when YAML parsed an unquoted date)
 * into structured data, which Google reports as an invalid value.
 */
export function toStoryIsoDate(value: string | null | undefined): string | null {
  return toStoryDate(value)?.toISOString() ?? null
}
