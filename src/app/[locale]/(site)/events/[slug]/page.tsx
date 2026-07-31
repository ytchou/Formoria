import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { EventBrandGrid } from '@/components/events/event-brand-grid'
import { eventPhaseBadgeVariant } from '@/components/events/event-card'
import { formatEventDateRange } from '@/components/events/event-date'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { safeDecodeSlug } from '@/lib/url'
import {
  deriveAreaOptions,
  getEventBrandEntries,
  getPublishedEventBySlug,
  getPublishedEvents,
  resolveEventPhase,
  taipeiToday,
} from '@/lib/services/events'
import { getStorySeries } from '@/lib/services/stories'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import {
  buildBreadcrumbJsonLd,
  buildEventJsonLd,
  safeJsonLdStringify,
} from '@/lib/json-ld'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

export const revalidate = 3600

// CRITICAL: deliberately no `dynamic = 'force-static'`. It strips request-scoped
// state, so next-intl's `getRequestLocale()` returns undefined and
// `src/i18n/request.ts` silently falls back to zh-TW on on-demand/ISR renders
// while `params.locale` still says `en` — an English URL serving Chinese copy,
// with `<html lang>` reporting the wrong thing on top of it. `revalidate` plus
// `generateStaticParams` gives SSG+ISR without that failure mode.
//
// CRITICAL: this route reads no dynamic API — no `cookies()`, no `headers()`,
// no `searchParams`. That is only safe because the area filter is entirely
// client-side (`EventBrandGrid` mirrors `?area=` with `history.replaceState`).
// Reading one here would flip the route to dynamic and this `revalidate` would
// never produce a static entry.

/**
 * Prebuild every published event so the first production visit is served from
 * the ISR cache. Returns `{ slug }` ONLY — locale is contributed by the parent
 * `[locale]` layout's own `generateStaticParams`, so returning it here would
 * multiply the matrix against itself.
 *
 * Wrapped in try/catch: a transient DB error at build time must degrade to
 * "nothing prerendered, everything rendered on demand", not fail the whole
 * build. The service throws on query errors by design.
 */
export async function generateStaticParams() {
  try {
    const events = await getPublishedEvents()
    return events.map((event) => ({ slug: event.slug }))
  } catch (error) {
    console.error('generateStaticParams(/events/[slug]) failed:', error)
    return []
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  // Event slugs are ASCII kebab-case today, but the route param arrives
  // percent-encoded whenever a link is built with `encodeURIComponent`, and the
  // DB lookup is on the decoded value. `safeDecodeSlug` rather than a bare
  // `decodeURIComponent`: the latter throws `URIError` on a malformed escape
  // (`/events/%zz`), which surfaces as a 500 through the error boundary — and
  // one error report per crawler probe — instead of the 404 that request
  // deserves.
  const slug = safeDecodeSlug(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const event = slug ? await getPublishedEventBySlug(slug) : null

  if (!event) {
    notFound()
  }

  const isEnglish = safeLocale === 'en'
  const name = isEnglish ? (event.nameEn ?? event.name) : event.name
  const description = isEnglish ? (event.summaryEn ?? event.summary) : event.summary

  // An event with no English name has no English edition: `/en/events/<slug>`
  // would serve byte-identical zh-TW copy, and a self-referencing canonical
  // there enters the index as a duplicate of the prefix-free URL. So that case
  // pins the canonical to 'zh-TW' on BOTH routes, folding the two into one
  // entry and matching the sitemap, which lists only the zh-TW URL for such an
  // event. The pin has to be made through the LOCALE argument: `buildAlternates`
  // derives the canonical from `locale` alone (`src/lib/seo/alternates.ts`), and
  // `availableLocales` only shapes the `languages` map — narrowing that list
  // while passing `safeLocale` would leave `/en` self-canonicalizing with no
  // self-reference in its own hreflang cluster. Same shape as
  // `/stories/[slug]`, which is zh-TW-only across the board. Events that DO
  // carry English copy self-canonicalize per locale and advertise both.
  const { canonical, languages } = buildAlternates(
    `/events/${event.slug}`,
    event.nameEn ? safeLocale : 'zh-TW',
    event.nameEn ? ['zh-TW', 'en'] : ['zh-TW'],
  )

  // Note the absence of a `robots: { index: false }` branch for past events.
  // Retrospective discovery ("who exhibited at Creative Expo 2026?") is a first-class
  // reason this surface exists. Google drops finished events from Event rich
  // results on its own; the page itself stays indexable.
  return {
    title: name,
    description,
    alternates: { canonical, languages },
  }
}

export default async function EventDetailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params
  // Same guard as `generateMetadata`: a malformed percent-escape is a 404, not
  // a `URIError` turned into a 500 by the error boundary.
  const slug = safeDecodeSlug(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const isEnglish = safeLocale === 'en'

  if (!slug) {
    notFound()
  }

  // Run together, not serially: `getEventBrandEntries` resolves the event by
  // slug inside its own query (`events!inner`), so it has no dependency on the
  // lookup beside it.
  const [event, entries] = await Promise.all([
    getPublishedEventBySlug(slug),
    getEventBrandEntries(slug),
  ])

  if (!event) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'events' })

  const name = isEnglish ? (event.nameEn ?? event.name) : event.name
  const summary = isEnglish ? (event.summaryEn ?? event.summary) : event.summary
  const description = isEnglish
    ? (event.descriptionEn ?? event.description)
    : event.description
  const venueName = isEnglish ? (event.venueNameEn ?? event.venueName) : event.venueName
  const phase = resolveEventPhase(event, taipeiToday())
  const dateLabel = formatEventDateRange(event.startsOn, event.endsOn)
  const areaOptions = deriveAreaOptions(entries, safeLocale)
  const heroSrc = safeImageSrc(event.heroImageUrl)

  // Events and stories join by convention: the event slug IS the story series
  // name. No FK, so a missing series is the normal case, not an error.
  //
  // The request locale is passed through, never left to the `'zh-TW'` default:
  // `getStorySeries` resolves against ONE published set, so an English reader
  // would otherwise be handed zh-TW story titles while an `en`-authored story
  // in this series never surfaced on `/en` at all. `/stories/[slug]` makes the
  // same call for the same reason (it resolves the story's own authored locale;
  // here the event page has both editions, so the request locale is the set to
  // ask for).
  const seriesResult = await getStorySeries(slug, safeLocale)
  const relatedStories = seriesResult.ok ? seriesResult.stories : []

  const eventJsonLd = buildEventJsonLd({
    name,
    description: summary,
    path: `/events/${event.slug}`,
    locale: safeLocale,
    startDate: event.startsOn,
    // `endDate` is omitted for a single-day event per `EventJsonLdInput`, so a
    // one-day fair does not advertise a zero-length range.
    endDate: event.endsOn === event.startsOn ? null : event.endsOn,
    venueName,
    venueAddress: event.venueAddress,
    city: event.city,
    organizerName: event.organizerName,
    imageUrl: heroSrc,
    isFree: event.isFree,
    ticketUrl: event.ticketUrl,
  })
  // Item-for-item mirror of the visible `<ol>` below — the two must never
  // disagree, which is why they are written next to each other.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{ label: t('breadcrumb'), href: '/events' }, { label: name }],
    safeLocale,
  )

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(eventJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
      />

      <nav aria-label={t('breadcrumbAria')} className="mb-6">
        <ol className="flex items-center gap-1.5 type-card-description">
          <li>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- DEV-1280: full-document navigation avoids a stalled RSC request across the locale proxy rewrite. */}
            <a href="/events" className="transition-colors hover:text-foreground">
              {t('breadcrumb')}
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <span aria-current="page" className="text-foreground">
              {name}
            </span>
          </li>
        </ol>
      </nav>

      <article className="space-y-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={eventPhaseBadgeVariant[phase]}>{t(`phase.${phase}`)}</Badge>
            {event.isFree === true ? <Badge variant="outline">{t('free')}</Badge> : null}
          </div>
          <h1 className="type-page-title-large text-balance">{name}</h1>
          <p className="max-w-2xl type-page-subtitle">{summary}</p>

          {heroSrc ? (
            <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-muted">
              {/* Decorative: the event name is the adjacent `<h1>`, so alt text
                  here would only repeat it to a screen reader. */}
              <Image
                src={heroSrc}
                alt=""
                fill
                priority
                sizes="(max-width: 1280px) 100vw, 1280px"
                className="object-cover"
              />
            </div>
          ) : null}

          <dl className="grid max-w-2xl gap-x-6 gap-y-3 sm:grid-cols-2">
            {dateLabel ? (
              <div className="space-y-1">
                <dt className="type-caption">{t('dates')}</dt>
                <dd className="type-metadata">{dateLabel}</dd>
              </div>
            ) : null}
            {venueName ? (
              <div className="space-y-1">
                <dt className="type-caption">{t('venue')}</dt>
                <dd className="type-metadata">
                  {venueName}
                  {event.venueAddress ? (
                    <span className="block type-caption">{event.venueAddress}</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {event.organizerName ? (
              <div className="space-y-1">
                <dt className="type-caption">{t('organizer')}</dt>
                <dd className="type-metadata">{event.organizerName}</dd>
              </div>
            ) : null}
          </dl>

          {event.officialUrl || event.ticketUrl ? (
            <div className="flex flex-wrap gap-3">
              {event.officialUrl ? (
                <a
                  href={event.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'primary', tone: 'cta' })}
                >
                  {t('officialSite')}
                </a>
              ) : null}
              {event.ticketUrl ? (
                <a
                  href={event.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'secondary' })}
                >
                  {t('tickets')}
                </a>
              ) : null}
            </div>
          ) : null}
        </header>

        {description ? (
          <p className="max-w-2xl whitespace-pre-wrap type-body">{description}</p>
        ) : null}

        <section aria-labelledby="event-brands" className="space-y-4">
          <h2 id="event-brands" className="type-section-title">
            {t('brandsHeading')}
          </h2>
          {/*
            A lineup that has not been published yet renders the message and
            nothing else: no filter bar (there is nothing to filter) and no
            `ViewItemListTracker` — an empty `view_item_list` is GA4 noise, not
            a datapoint. `/stories/[slug]` makes the same call.
          */}
          {entries.length === 0 ? (
            <p className="type-empty-body">{t('noBrands')}</p>
          ) : (
            <EventBrandGrid
              entries={entries}
              areaOptions={areaOptions}
              eventSlug={event.slug}
              locale={safeLocale}
            />
          )}
        </section>

        {relatedStories.length > 0 ? (
          <section aria-labelledby="event-related-stories" className="space-y-4">
            <h2 id="event-related-stories" className="type-section-title">
              {t('relatedStories')}
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {relatedStories.map((story) => (
                <li key={story.slug}>
                  <Link
                    href={`/stories/${story.slug}`}
                    className={surfaceCardStyles({
                      className: 'group block hover:bg-secondary',
                      interactive: true,
                    })}
                  >
                    <h3 className="type-card-title group-hover:underline">
                      {story.frontmatter.title}
                    </h3>
                    {story.frontmatter.description ? (
                      <p className="mt-2 type-body-muted line-clamp-2">
                        {story.frontmatter.description}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </main>
  )
}
