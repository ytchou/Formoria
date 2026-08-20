import { getLocale, getTranslations } from 'next-intl/server'
import { ExternalLink } from 'lucide-react'

import { formatEventDateRange } from '@/components/events/event-date'
import { SeriesList } from '@/components/stories/series-nav'
import { buttonVariants } from '@/components/ui/button'
import { InfoField, SurfaceCard } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { getPublishedEventBySlug, type Event } from '@/lib/services/events'
import { getStorySeries, type StoryListResult, type StoryLocale } from '@/lib/services/stories'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

type EventLoader = (slug: string) => Promise<Event | null>
type SeriesLoader = (slug: string, locale: StoryLocale) => Promise<StoryListResult>

export type EventInfoProps = {
  slug: string
  currentStorySlug?: string
  loadEvent?: EventLoader
  loadSeries?: SeriesLoader
}

export async function EventInfo({
  slug,
  currentStorySlug,
  loadEvent = getPublishedEventBySlug,
  loadSeries = getStorySeries,
}: EventInfoProps) {
  const locale = await getLocale()
  const authoredLocale: StoryLocale = locale === 'en' ? 'en' : 'zh-TW'
  const [event, seriesResult] = await Promise.all([
    loadEvent(slug),
    loadSeries(slug, authoredLocale),
  ])
  const series = seriesResult.ok ? seriesResult.stories : []
  const hasSeries = series.length >= 2

  if (!event && !hasSeries) return null

  const t = await getTranslations({ locale, namespace: 'stories' })
  const name = event ? (locale === 'en' ? event.nameEn || event.name : event.name) : null
  const scheduleNote = event
    ? locale === 'en'
      ? event.scheduleNoteEn || event.scheduleNote
      : event.scheduleNote
    : null
  const venueName = event
    ? locale === 'en'
      ? event.venueNameEn || event.venueName
      : event.venueName
    : null
  const admissionNote = event
    ? locale === 'en'
      ? event.admissionNoteEn || event.admissionNote
      : event.admissionNote
    : null

  return (
    // Full body width rather than the `max-w-2xl` an inline figure uses: this is
    // a reference block, and at figure width its four fields stacked into a
    // column tall enough to push the article's first section below the fold.
    <SurfaceCard padding="none" className="mx-auto mt-7 mb-6 w-full">
      {event ? (
        <section className="p-5">
          {/* Same step as the series heading below it — the two halves of this
              card are peers, so they carry the same heading level and scale. */}
          <h2 className="type-body-sm font-semibold text-ink">{name}</h2>
          {/* Two columns from `sm` up: the short fields pair off instead of each
              taking a full row. `admissionNote` is a sentence, not a value, so it
              spans both and reads as the paragraph it is. */}
          <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <InfoField
              label={t('eventDates')}
              value={formatEventDateRange(event.startsOn, event.endsOn)}
            />
            {venueName ? <InfoField label={t('eventVenue')} value={venueName} /> : null}
            {scheduleNote ? (
              <InfoField
                label={t('eventHours')}
                value={<span className="whitespace-pre-line">{scheduleNote}</span>}
                wide
              />
            ) : null}
            {admissionNote ? (
              <InfoField label={t('eventAdmission')} value={admissionNote} wide />
            ) : null}
          </dl>

          <div className="mt-5 flex flex-wrap gap-3">
            {event.officialUrl ? (
              <a
                href={event.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({
                  variant: 'primary',
                  size: 'large',
                })}
              >
                {t('eventOfficialSite')}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            ) : null}
            {event.ticketUrl ? (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({
                  variant: 'secondary',
                  size: 'large',
                })}
              >
                {t('eventBookOnline')}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            ) : null}
            <Link
              href={routes.event(slug)}
              className={buttonVariants({
                variant: 'secondary',
                size: 'large',
              })}
            >
              {t('eventPage')}
            </Link>
          </div>
          <p className="mt-4 type-metadata">{t('eventFinePrint')}</p>
        </section>
      ) : null}

      {hasSeries ? (
        <section
          id="series"
          aria-label={t('seriesNavAria')}
          // The hairline only exists to separate the two halves — without the
          // event half above it, it would read as a rule hanging off the top of
          // the card. `scroll-mt-24` keeps the `#series` target clear of the
          // sticky header.
          className={cn('scroll-mt-24 p-5', event && 'border-t border-rule')}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="type-body-sm font-semibold text-ink">{t('seriesHeading')}</h2>
            <p className="type-metadata">{t('seriesCount', { count: series.length })}</p>
          </div>
          <SeriesList series={series} currentSlug={currentStorySlug ?? ''} />
        </section>
      ) : null}
    </SurfaceCard>
  )
}
