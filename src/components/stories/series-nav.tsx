import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import type { AppLocale } from '@/i18n/locale-preference'
import type { StoryEntry } from '@/lib/services/stories'
import { routes } from '@/lib/routes'

type SeriesNavProps = {
  /** Series members, already ordered by `getStorySeries`. */
  series: StoryEntry[]
  /** Filename stem of the story currently being read. */
  currentSlug: string
  locale: AppLocale
}

export async function SeriesNav({ series, currentSlug, locale }: SeriesNavProps) {
  // A "series" of one is just a story — render nothing rather than a nav
  // pointing at the page you are already on.
  if (series.length < 2) return null

  const t = await getTranslations({ locale, namespace: 'stories' })

  return (
    <nav
      // The sticky header would otherwise cover the top of the series nav when linked.
      id="series"
      aria-label={t('seriesNavAria')}
      className="scroll-mt-24 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="type-body-sm font-semibold text-ink">{t('seriesHeading')}</h2>
        <p className="type-metadata">{t('seriesCount', { count: series.length })}</p>
      </div>

      <SeriesList series={series} currentSlug={currentSlug} />
    </nav>
  )
}

export function SeriesList({ series, currentSlug }: Omit<SeriesNavProps, 'locale'>) {
  return (
    <ol className="mt-3 divide-y divide-border">
      {series.map((entry, index) => {
        const isCurrent = entry.slug === currentSlug
        const position = (
          <span className="w-5 shrink-0 tabular-nums type-metadata" aria-hidden="true">
            {index + 1}
          </span>
        )

        return (
          <li key={entry.slug}>
            {isCurrent ? (
              <span
                aria-current="page"
                className="flex min-h-11 items-center gap-3 py-2 type-body-sm font-medium text-ink"
              >
                {position}
                {entry.frontmatter.title}
              </span>
            ) : (
              // Link by the top-level `slug` (the filename stem) — that is what
              // `generateStaticParams` registers. `frontmatter.slug` 404s.
              <Link
                href={routes.story(entry.slug)}
                className="flex min-h-11 items-center gap-3 rounded-lg py-2 type-body-sm text-ink-soft transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {position}
                {entry.frontmatter.title}
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}
