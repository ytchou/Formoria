import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { EventCard } from '@/components/events/event-card'
import {
  getEventBrandCounts,
  getPublishedEvents,
  partitionEventsByPhase,
  resolveEventPhase,
  taipeiToday,
  type Event,
} from '@/lib/services/events'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

type PageProps = {
  params: Promise<{ locale: string }>
}

// Deliberately paired with a page signature that takes NO `searchParams`.
// Reading `searchParams` (in the body OR in `generateMetadata`) opts the route
// into dynamic rendering, at which point this `revalidate` never materializes
// into a static ISR entry — the exact trap documented on `/brands`
// (`src/app/[locale]/(site)/brands/page.tsx:33-38`). The hub has no query-string
// state to read, so it stays static. There is intentionally no `dynamic` export.
export const revalidate = 3600

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({ locale, namespace: 'events' })
  // Both locales, unlike `/stories/[slug]`: every string on this page comes
  // from the `events` message namespace, which is fully translated, so `/en`
  // serves genuinely English chrome rather than a zh-TW duplicate.
  const { canonical, languages } = buildAlternates('/events', safeLocale)

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical, languages },
  }
}

export default async function EventsHubPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'events' })

  // One Taipei "today" for the whole render: partitioning on one value and
  // badging on another could put an event in the upcoming section wearing an
  // "ongoing" pill if the render straddled midnight.
  const today = taipeiToday()
  const events = await getPublishedEvents()
  const byPhase = partitionEventsByPhase(events, today)
  const brandCounts = await getEventBrandCounts(events.map((event) => event.id))

  // Ongoing and upcoming share one section. Merging then sorting ascending by
  // `startsOn` needs no second rule to put "happening now" first: an event that
  // is already running started before one that has not begun.
  const upcoming: Event[] = [...byPhase.ongoing, ...byPhase.upcoming].sort((a, b) =>
    a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0,
  )
  // Already descending by `endsOn` out of `partitionEventsByPhase` — the most
  // recently finished event reads first.
  const past = byPhase.past

  const renderCard = (event: Event) => {
    const count = brandCounts.get(event.id) ?? 0
    const phase = resolveEventPhase(event, today)

    return (
      <EventCard
        key={event.id}
        event={event}
        phase={phase}
        phaseLabel={t(`phase.${phase}`)}
        brandCountLabel={count > 0 ? t('brandCount', { count }) : null}
        locale={locale}
        headingLevel={3}
      />
    )
  }

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <div className="space-y-8">
        <header className="space-y-3">
          <h1 className="type-page-title">{t('heading')}</h1>
          <p className="max-w-2xl type-body-muted">{t('subheading')}</p>
        </header>

        {/*
          Zero published events is a 200 with an empty state, not a 404: the hub
          is a permanent, linkable surface whose content simply has not landed
          yet. Same shape as the stories hub's `comingSoon` block.
        */}
        {events.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-secondary px-6 py-16 text-center">
            <p className="type-empty-body">{t('comingSoon')}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* A section with no members renders nothing at all — no heading
                above an empty grid, in either direction. */}
            {upcoming.length > 0 ? (
              <section aria-labelledby="events-upcoming" className="space-y-4">
                <h2 id="events-upcoming" className="type-section-title">
                  {t('upcomingHeading')}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {upcoming.map(renderCard)}
                </div>
              </section>
            ) : null}

            {past.length > 0 ? (
              <section aria-labelledby="events-past" className="space-y-4">
                <h2 id="events-past" className="type-section-title">
                  {t('pastHeading')}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {past.map(renderCard)}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
