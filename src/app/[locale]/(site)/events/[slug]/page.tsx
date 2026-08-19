import type { Metadata } from "next";
import { SurfaceImage } from "@/components/ui/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight, ExternalLink } from "lucide-react";
import { EventBrandGrid } from "@/components/events/event-brand-grid";
import { TaiwanCreativeExpoExplorer } from "@/components/events/taiwan-creative-expo-explorer";
import { TaiwanCreativeExpoOfficialMap } from "@/components/events/taiwan-creative-expo-official-map";
import { eventPhaseBadgeVariant } from "@/components/events/event-card";
import { formatEventDateRange } from "@/components/events/event-date";
import { StoryRow } from "@/components/stories/story-row";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { textStyles } from "@/components/ui/text-styles";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { safeDecodeSlug } from "@/lib/url";
import { shuffle } from "@/lib/utils";
import {
  deriveAreaOptions,
  deriveCategoryOptions,
  getEventBrandEntries,
  getEventExhibitorEntries,
  getPublishedEventBySlug,
  getPublishedEvents,
  resolveEventPhase,
  taipeiToday,
  projectLinkedEventExhibitorEntries,
  selectCreativeExpoEntries,
  selectLinkedEventExhibitorEntries,
  type EventBrandEntry,
  type EventExhibitorEntry,
} from "@/lib/services/events";
import { verifyCreativeExpoPlacement } from "@/lib/events/creative-expo-explorer";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { getStorySeriesByRecency } from "@/lib/services/stories";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import {
  buildBreadcrumbJsonLd,
  buildEventJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 3600;

// CRITICAL: deliberately no `dynamic = 'force-static'`. It strips request-scoped
// state, so next-intl's `getRequestLocale()` returns undefined and
// `src/i18n/request.ts` silently falls back to zh-TW on on-demand/ISR renders
// while `params.locale` still says `en` — an English URL serving Chinese copy,
// with `<html lang>` reporting the wrong thing on top of it. `revalidate` plus
// `generateStaticParams` gives SSG+ISR without that failure mode.
//
// CRITICAL: this route reads no dynamic API — no `cookies()`, no `headers()`,
// no `searchParams`. That is only safe because the lineup filters are entirely
// client-side (`EventBrandGrid` mirrors `?area=` and `?category=` with
// `history.replaceState`).
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
  // Targeted E2E builds exercise selected routes at runtime; unrelated DB-backed
  // prerenders must not prevent the browser journey from starting.
  if (process.env.PLAYWRIGHT_TEST === "true") return [];

  try {
    const events = await getPublishedEvents();
    return events.map((event) => ({ slug: event.slug }));
  } catch (error) {
    console.error("generateStaticParams(/events/[slug]) failed:", error);
    return [];
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  // Event slugs are ASCII kebab-case today, but the route param arrives
  // percent-encoded whenever a link is built with `encodeURIComponent`, and the
  // DB lookup is on the decoded value. `safeDecodeSlug` rather than a bare
  // `decodeURIComponent`: the latter throws `URIError` on a malformed escape
  // (`/events/%zz`), which surfaces as a 500 through the error boundary — and
  // one error report per crawler probe — instead of the 404 that request
  // deserves.
  const slug = safeDecodeSlug(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const event = slug ? await getPublishedEventBySlug(slug) : null;

  if (!event) {
    notFound();
  }

  const isEnglish = safeLocale === "en";
  const name = isEnglish ? (event.nameEn ?? event.name) : event.name;
  const description = isEnglish
    ? (event.summaryEn ?? event.summary)
    : event.summary;

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
    routes.event(event.slug),
    event.nameEn ? safeLocale : "zh-TW",
    event.nameEn ? ["zh-TW", "en"] : ["zh-TW"],
  );

  // Note the absence of a `robots: { index: false }` branch for past events.
  // Retrospective discovery ("who exhibited at Creative Expo 2026?") is a first-class
  // reason this surface exists. Google drops finished events from Event rich
  // results on its own; the page itself stays indexable.
  return {
    title: name,
    description,
    alternates: { canonical, languages },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params;
  // Same guard as `generateMetadata`: a malformed percent-escape is a 404, not
  // a `URIError` turned into a 500 by the error boundary.
  const slug = safeDecodeSlug(rawSlug);
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const isEnglish = safeLocale === "en";

  if (!slug) {
    notFound();
  }

  const isCreativeExpo = slug === "2026-taiwan-creative-expo";
  // Run together, not serially: `getEventBrandEntries` resolves the event by
  // slug inside its own query (`events!inner`), so it has no dependency on the
  // lookup beside it.
  const [event, lineupRead] = await Promise.all([
    getPublishedEventBySlug(slug),
    isCreativeExpo
      ? getEventExhibitorEntries(slug).catch(
          captureReadFailure("events.creativeExpo.exhibitors"),
        )
      : getEventBrandEntries(slug),
  ]);

  if (!event) {
    notFound();
  }

  const rosterFailed = isCreativeExpo && lineupRead === null;
  if (rosterFailed) {
    // A failed canonical roster must not be frozen by this page's ISR window;
    // the event copy, map, and logistics remain useful while the next request
    // retries the read.
    await markRenderDegraded("events.creativeExpo.exhibitors");
  }

  // The explorer renders the whole hall; the linked-only projection stays for
  // the shared `EventBrandGrid` entry shape below.
  const creativeExpoEntries = isCreativeExpo
    ? selectCreativeExpoEntries(
        (lineupRead as EventExhibitorEntry[] | null) ?? [],
      )
    : [];
  const linkedCreativeExpoEntries = isCreativeExpo
    ? selectLinkedEventExhibitorEntries(
        (lineupRead as EventExhibitorEntry[] | null) ?? [],
      )
    : [];
  if (isCreativeExpo && lineupRead !== null) {
    // Placement is a property of the roster row, not of the brand link, so the
    // integrity warn runs over every exhibitor rather than the linked subset.
    const placementMismatches = creativeExpoEntries.flatMap((entry) => {
      const verification = verifyCreativeExpoPlacement(entry);
      return verification.consistent
        ? []
        : [
            {
              sourceKey: entry.sourceKey,
              booth: entry.booth,
              canonicalZone: verification.canonicalZone,
              boothZone: verification.boothZone,
            },
          ];
    });

    if (placementMismatches.length > 0) {
      console.warn(
        "Creative Expo canonical zone/booth mismatches:",
        placementMismatches,
      );
    }
  }
  const entries: EventBrandEntry[] = isCreativeExpo
    ? projectLinkedEventExhibitorEntries(linkedCreativeExpoEntries)
    : (lineupRead as EventBrandEntry[]);

  const t = await getTranslations({ locale, namespace: "events" });

  const name = isEnglish ? (event.nameEn ?? event.name) : event.name;
  const summary = isEnglish
    ? (event.summaryEn ?? event.summary)
    : event.summary;
  const venueName = isEnglish
    ? (event.venueNameEn ?? event.venueName)
    : event.venueName;
  // Visitor-decision fields. All four are null on every event but the Creative
  // Expo, so each render site below is guarded independently rather than as one
  // block — an event may carry travel info and no schedule.
  const scheduleNote = isEnglish
    ? (event.scheduleNoteEn ?? event.scheduleNote)
    : event.scheduleNote;
  const travelNote = isEnglish
    ? (event.travelNoteEn ?? event.travelNote)
    : event.travelNote;
  const admissionNote = isEnglish
    ? (event.admissionNoteEn ?? event.admissionNote)
    : event.admissionNote;
  const lineupNote = isEnglish
    ? (event.lineupNoteEn ?? event.lineupNote)
    : event.lineupNote;
  const phase = resolveEventPhase(event, taipeiToday());
  const dateLabel = formatEventDateRange(event.startsOn, event.endsOn);
  const areaOptions = deriveAreaOptions(entries, safeLocale);
  const categoryOptions = deriveCategoryOptions(entries, safeLocale);
  const heroSrc = safeImageSrc(event.heroImageUrl);

  // Booth order permanently privileges whoever holds the lowest booth number,
  // and the first row is the only one most readers see. Shuffled HERE, in the
  // server component: `Math.random()` inside `EventBrandGrid` would order the
  // server and client renders differently and break hydration, and
  // `composeEventBrands` owes its callers a stable order.
  //
  // The route is SSG+ISR, so this fixes one order per regeneration window
  // rather than reshuffling per visitor — every brand gets the top row for a
  // stretch of time, which is the fairness property intended, not a staleness
  // bug. The chip options above are derived from the UNSHUFFLED list so the
  // filter bar keeps a stable order across regenerations.
  const lineup = isCreativeExpo ? entries : shuffle(entries);

  // Routing handoff, built from the address rather than a stored URL: a map
  // link that has to be authored per event is a map link that goes stale or
  // never gets filled in. `?api=1` is Google's documented cross-platform form
  // and hands off to the native app on mobile.
  const mapsQuery = [venueName, event.venueAddress].filter(Boolean).join(" ");
  const mapsUrl = mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    : null;

  // Events and stories join by convention: the event slug IS the story series
  // name. No FK, so a missing series is the normal case, not an error.
  //
  // Ordered by recency, not by `seriesOrder`: this list answers "what is newest
  // about this event", so a part 1 revised yesterday belongs above a part 4
  // published last month. `/stories/[slug]`'s series nav keeps authored order —
  // that one answers "what is part 3", which is a different question.
  //
  // The request locale is passed through, never left to the `'zh-TW'` default:
  // the service resolves against ONE published set, so an English reader
  // would otherwise be handed zh-TW story titles while an `en`-authored story
  // in this series never surfaced on `/en` at all. `/stories/[slug]` makes the
  // same call for the same reason (it resolves the story's own authored locale;
  // here the event page has both editions, so the request locale is the set to
  // ask for).
  const seriesResult = await getStorySeriesByRecency(slug, safeLocale);
  const relatedStories = seriesResult.ok ? seriesResult.stories : [];

  const eventJsonLd = buildEventJsonLd({
    name,
    description: summary,
    path: routes.event(event.slug),
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
  });
  // Item-for-item mirror of the visible `<ol>` below — the two must never
  // disagree, which is why they are written next to each other.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{ label: t("breadcrumb"), href: routes.events() }, { label: name }],
    safeLocale,
  );

  return (
    <main className="page-gutter mx-auto w-full page-measure py-10 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(eventJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(breadcrumbJsonLd),
        }}
      />

      <nav aria-label={t("breadcrumbAria")} className="mb-6">
        <ol className="flex items-center gap-1.5 type-body-sm">
          <li>
            {/* A raw `<a>`, not next/link. DEV-1280: full-document navigation avoids a
              stalled RSC request across the locale proxy rewrite. The
              `no-html-link-for-pages` suppression that used to sit here is gone with
              the literal href — the rule only inspects string literals, so routing
              this through `@/lib/routes` left the directive unused, which
              `reportUnusedDisableDirectives: "error"` fails on. */}
            <a
              href={routes.events()}
              className="transition-colors hover:text-foreground"
            >
              {t("breadcrumb")}
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

      <article className="space-y-12">
        {/* Band A — hero, full width. */}
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={eventPhaseBadgeVariant[phase]}>
              {t(`phase.${phase}`)}
            </Badge>
            {event.isFree === true ? (
              <Badge variant="outline">{t("free")}</Badge>
            ) : null}
          </div>
          <h1 className="type-page-title text-balance">{name}</h1>
          {/* Full measure, not `max-w-2xl`: the summary is one or two lines of
              scene-setting, not body copy, and a half-width block under a
              full-width `h1` read as an unfinished column. */}
          <p className="type-body">{summary}</p>
        </header>

        {heroSrc ? (
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-muted">
            {/* Decorative: the event name is the adjacent `<h1>`, so alt text
                here would only repeat it to a screen reader. */}
            <SurfaceImage
              src={heroSrc}
              alt=""
              fill
              priority
              surface="hero"
              className="object-cover"
            />
          </div>
        ) : null}

        {event.officialUrl || event.ticketUrl || mapsUrl ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {event.officialUrl ? (
                <a
                  href={event.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: "primary",
                    size: "large",
                    className: "w-full sm:w-auto",
                  })}
                >
                  {t("officialSite")}
                </a>
              ) : null}
              {event.ticketUrl ? (
                <a
                  href={event.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: "secondary",
                    size: "large",
                    className: "w-full sm:w-auto",
                  })}
                >
                  {/* A free event's ticket link books a slot, it does not sell
                        one — a "ticket info" label on free entry reads as a paywall. */}
                  {t(event.isFree === true ? "reserve" : "tickets")}
                </a>
              ) : null}
              {/* Routing, not a rendered map: an embedded map needs an API key
                    and a CSP frame-src exception, and hands the reader a pane to
                    pinch on a page that is otherwise all text and cards. The
                    link opens whichever map app the device already trusts. */}
              {mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: "secondary",
                    size: "large",
                    className: "w-full sm:w-auto",
                  })}
                >
                  {t("directions")}
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              ) : null}
            </div>
            {/* Only under a ticket link: the note answers "what if booking
                  is full", a question that only exists once there is
                  something to book. */}
            {event.ticketUrl ? (
              <p className="type-metadata">{t("reserveNote")}</p>
            ) : null}
          </div>
        ) : null}

        {/*
          Band B — the "about this event" section. Was a 352px right rail, then a
          grid of bordered fact cards; both were more chrome than this content
          earns. It is now a titled section: the facts as a plain two-column
          definition list on hairline rules, then the official introduction as
          prose.

          The facts lead the section, and the prose follows, because the two
          serve different readers. Someone who already knows what this event is
          came for dates, venue, and admission, and those must be answerable
          without reading a paragraph — one of them is safety-critical: 8/6-8/7
          are trade-buyer days, so a reader scanning the date range can
          otherwise turn up on a day that is closed to them.

          Actions sit above the section heading entirely: they are what a reader
          who already knows the event came here to DO, and anywhere below the
          fact list they landed under the page fold on a laptop.
        */}
        <section aria-labelledby="event-about" className="space-y-8">
          <h2 id="event-about" className="type-card-title">
            {t("about")}
          </h2>

          <dl
            aria-label={t("visitInfo")}
            className="divide-y divide-border border-t border-border"
          >
            {dateLabel ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("dates")}
                </dt>
                <dd className={textStyles({ variant: "fieldValue" })}>
                  {dateLabel}
                </dd>
              </div>
            ) : null}
            {/* Directly after the date range it qualifies: "8/6–8/12" is the
                claim that sends someone to the door on a trade-buyer-only day,
                so the correction has to be the next thing read. */}
            {scheduleNote ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("schedule")}
                </dt>
                {/* Authored as one line per audience — `whitespace-pre-line` is
                    what keeps those lines from collapsing into a run-on
                    paragraph. The single-paragraph notes must not have it. */}
                <dd
                  className={textStyles({
                    variant: "fieldValue",
                    className: "whitespace-pre-line",
                  })}
                >
                  {scheduleNote}
                </dd>
              </div>
            ) : null}
            {venueName ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("venue")}
                </dt>
                <dd className={textStyles({ variant: "fieldValue" })}>
                  {venueName}
                  {event.venueAddress ? (
                    <span className="block type-metadata">
                      {event.venueAddress}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {travelNote ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("travel")}
                </dt>
                <dd className={textStyles({ variant: "fieldValue" })}>
                  {travelNote}
                </dd>
              </div>
            ) : null}
            {admissionNote ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("admission")}
                </dt>
                <dd className={textStyles({ variant: "fieldValue" })}>
                  {admissionNote}
                </dd>
              </div>
            ) : null}
            {event.organizerName ? (
              <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className={textStyles({ variant: "fieldLabel" })}>
                  {t("organizer")}
                </dt>
                <dd className={textStyles({ variant: "fieldValue" })}>
                  {event.organizerName}
                </dd>
              </div>
            ) : null}
          </dl>
          {/*
            The organizer's floor plan closes the venue facts rather than
            sitting in the brand explorer: it is reference material about the
            hall, and unlike every control in the explorer it filters nothing.
          */}
          {isCreativeExpo ? <TaiwanCreativeExpoOfficialMap /> : null}
        </section>

        {/*
          Band C — full width so `MasonryGrid` keeps its widest column count.

          The region is named by `aria-label` rather than by its heading,
          because the heading is not always rendered: the Creative Expo
          explorer carries its own, so a title above it announced the same
          thing twice. Every other event keeps the visible one — its grid has
          no heading of its own.
        */}
        <section aria-label={t("brandsHeading")} className="space-y-4">
          {isCreativeExpo ? null : (
            <h2 className="type-card-title">{t("brandsHeading")}</h2>
          )}
          {/*
            Source attribution plus the "exhibiting is not an endorsement"
            disclaimer. Deliberately a muted caption and not a callout: it
            qualifies the list rather than warning about it, and a bordered or
            tinted box here would outweigh the lineup it introduces. No label
            key — the heading above already names what is being qualified.
          */}
          {lineupNote ? <p className="type-metadata">{lineupNote}</p> : null}
          {/*
            A lineup that has not been published yet renders the message and
            nothing else: no filter bar (there is nothing to filter) and no
            `ViewItemListTracker` — an empty `view_item_list` is GA4 noise, not
            a datapoint. `/stories/[slug]` makes the same call.
          */}
          {isCreativeExpo ? (
            <Suspense fallback={null}>
              <TaiwanCreativeExpoExplorer
                entries={creativeExpoEntries}
                eventSlug={event.slug}
                locale={safeLocale}
                rosterFailed={rosterFailed}
              />
            </Suspense>
          ) : entries.length === 0 ? (
            <p className="type-body-sm">{t("noBrands")}</p>
          ) : (
            <EventBrandGrid
              entries={lineup}
              areaOptions={areaOptions}
              categoryOptions={categoryOptions}
              eventSlug={event.slug}
              locale={safeLocale}
            />
          )}
        </section>

        {/*
          Band D — stories close the page, below the lineup: a reader who has
          worked through the brands is the one with an appetite for the longer
          reads. Separated by whitespace only, never a tinted band.
        */}
        <section aria-labelledby="event-related-stories" className="space-y-4">
          <h2 id="event-related-stories" className="type-card-title">
            {t("relatedStories")}
          </h2>
          {relatedStories.length === 0 ? (
            // The heading stays even with nothing under it, so the page has the
            // same shape on every event. Title only — no icon, no action: this
            // is the common case, not a failure.
            <EmptyState title={t("storiesEmptyTitle")} />
          ) : (
            // Same `StoryRow` list as the homepage and /stories: one story
            // presentation across the site, and a date-led row reads at any
            // count, unlike a grid that had to drop to one column below two.
            <div className="divide-y divide-border border-y border-border">
              {relatedStories.map((story) => (
                <StoryRow
                  key={story.slug}
                  story={story}
                  locale={safeLocale}
                  headingLevel={3}
                />
              ))}
            </div>
          )}
        </section>
      </article>
    </main>
  );
}
