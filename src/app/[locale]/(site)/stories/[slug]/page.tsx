import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import {
  getAllStories,
  getPublishedStoryBySlug,
  getStorySeries,
  type StoryLocale,
} from '@/lib/services/stories'
import { FaqBlock } from '@/components/stories/faq-block'
import { SeriesNav } from '@/components/stories/series-nav'
import { formatStoryDate, toStoryIsoDate } from '@/components/stories/story-date'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { extractBrandSlugs } from '@/lib/mdx/extract-brand-slugs'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { StoryContent } from './story-content'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

export const revalidate = 3600

// Prebuild every published story so the first production visit is served from the
// ISR cache instead of paying on-demand generation. Locale comes from the parent
// `[locale]` layout's own `generateStaticParams`, so both locales are covered.
// `getAllStories()` is the same published set the index and sitemap use; anything
// outside it (drafts, future non-zh-TW stories) still renders on demand.
// Deliberately no `dynamic = 'force-static'`: it strips request-scoped state, so
// next-intl's `getRequestLocale()` returns undefined and `src/i18n/request.ts`
// silently falls back to zh-TW on on-demand/ISR renders while `params.locale`
// still says `en`. `revalidate` + `generateStaticParams` gives SSG+ISR without it.
export async function generateStaticParams() {
  const result = await getAllStories()
  if (!result.ok) return []
  // `story.slug` is the filename stem, which is what the route param resolves against
  // (`getPublishedStoryBySlug` reads `content/stories/<param>.mdx`); `frontmatter.slug`
  // is only used for canonical URLs and may diverge.
  return result.stories.map((story) => ({ slug: story.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const story = await getPublishedStoryBySlug(slug)

  if (!story) {
    notFound()
  }

  // Canonical is pinned to 'zh-TW' on BOTH routes, deliberately not `safeLocale`:
  // until English editions exist, `/en/stories/<slug>` serves byte-identical zh-TW
  // body copy, so a self-referencing canonical there would enter the index as a
  // duplicate of the prefix-free URL. `buildAlternates` is shared with /brands and
  // must stay locale-agnostic — the zh-TW-only decision belongs at this call site.
  const { canonical, languages } = buildAlternates(
    `/stories/${story.entry.frontmatter.slug}`,
    'zh-TW',
    ['zh-TW'],
  )

  // Per-story share card. Every page currently shares the site-wide default
  // from `src/app/opengraph-image.tsx`, so a story link in a group chat looks
  // identical to a link to the homepage. When the story declares a hero image,
  // that image becomes the card on both networks.
  //
  // `openGraph` is redeclared in full rather than patched: Next merges metadata
  // shallowly at the top level, so naming the key here replaces the locale
  // layout's whole object (siteName, type, locale). `/brands/[slug]` restates
  // the same fields for the same reason. Both keys are omitted entirely when
  // there is no hero image, which is what leaves the inherited default intact.
  const heroImage = story.entry.frontmatter.heroImage
  const ogLocale = locale === 'en' ? 'en_US' : 'zh_TW'

  return {
    title: story.entry.frontmatter.title,
    description: story.entry.frontmatter.description,
    alternates: { canonical, languages },
    ...(heroImage
      ? {
          openGraph: {
            siteName: 'Formoria',
            type: 'article' as const,
            locale: ogLocale,
            title: story.entry.frontmatter.title,
            description: story.entry.frontmatter.description,
            url: canonical,
            images: [
              {
                url: heroImage,
                // Falls back to the title here, unlike the in-page `<img>`:
                // an og:image alt is read in a preview card that carries no
                // other context, so repeating the title beats an empty string.
                alt: story.entry.frontmatter.heroImageAlt ?? story.entry.frontmatter.title,
              },
            ],
          },
          twitter: {
            title: story.entry.frontmatter.title,
            description: story.entry.frontmatter.description,
            images: heroImage,
          },
        }
      : {}),
  }
}

export default async function StoryPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const story = await getPublishedStoryBySlug(slug)

  if (!story) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'stories' })

  // Siblings are resolved against the story's OWN authored locale, not the request
  // locale: `/en` serves the zh-TW document, so asking for the (empty) `en` set here
  // would silently drop the series nav on exactly that route.
  const seriesId = story.entry.frontmatter.series
  const authoredLocale: StoryLocale =
    story.entry.frontmatter.locale === 'en' ? 'en' : 'zh-TW'
  const seriesResult = seriesId ? await getStorySeries(seriesId, authoredLocale) : null
  const series = seriesResult?.ok ? seriesResult.stories : []

  const articleJsonLd = buildArticleJsonLd({
    title: story.entry.frontmatter.title,
    description: story.entry.frontmatter.description ?? '',
    path: `/stories/${story.entry.frontmatter.slug}`,
    locale: safeLocale,
    author: story.entry.frontmatter.author ?? t('byline'),
  })
  // Both are omitted rather than emitted raw when the frontmatter date is
  // missing or unparseable: schema.org date properties must be ISO-8601, and an
  // empty (or JS `Date.toString()`) value is reported as invalid by Google.
  const datePublished = toStoryIsoDate(story.entry.frontmatter.publishedAt)
  const dateModified = toStoryIsoDate(story.entry.frontmatter.updatedAt)
  // Reader-facing date for the byline. Same formatter the series nav and the
  // event page's story cards use, so one story never shows two date formats.
  const publishedLabel = formatStoryDate(story.entry.frontmatter.publishedAt, safeLocale)
  // Mirrors the visible breadcrumb below, so the two never disagree. Same
  // builder every other content route uses (`/brands/[slug]`, `/glossary`).
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      { label: t('breadcrumb'), href: '/stories' },
      { label: story.entry.frontmatter.title },
    ],
    safeLocale,
  )
  // The shortcodes only resolve inside `MDXRemote`, which renders after this
  // component returns, so the list size is read off the raw source with the same
  // extractor the content guard uses. Zero brands means no list at all — an
  // empty `view_item_list` is noise in GA4, not a datapoint.
  const brandCount = extractBrandSlugs(story.content).length

  return (
    // `max-w-screen-xl`, the same container as `/events/[slug]` and the
    // `/stories` hub. It was a bespoke `max-w-[720px]` — the only hard-coded
    // page width in the app, and the reason a story read narrower than every
    // surface that links to it, including its own index.
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10 md:py-12">
      <nav aria-label={t('breadcrumbAria')} className="mb-6">
        <ol className="flex items-center gap-1.5 type-card-description">
          <li>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- DEV-1280: full-document navigation avoids a stalled RSC request across the locale proxy rewrite. */}
            <a
              href="/stories"
              className="hover:text-foreground transition-colors"
            >
              {t('breadcrumb')}
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <span aria-current="page" className="text-foreground">
              {story.entry.frontmatter.title}
            </span>
          </li>
        </ol>
      </nav>
      <article className="space-y-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify({
              ...articleJsonLd,
              ...(datePublished ? { datePublished } : {}),
              ...(dateModified ? { dateModified } : {}),
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
        />
        {brandCount > 0 ? (
          <ViewItemListTracker listName={`story:${slug}`} itemCount={brandCount} />
        ) : null}
        {/*
          Lead image, above the title the way a feature opens in print. Full
          container width and 16:9 rather than the capped 4:3 used by inline
          `<Figure>`s: this one is not illustrating a paragraph, it is the
          story's opening frame, and the wide crop keeps it from eating the
          fold on a laptop.
        */}
        {story.entry.frontmatter.heroImage ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-muted">
            {/*
              Two renderers, chosen by where the asset lives.

              A path (`/images/…`) is a repo asset: `next/image` can resize it,
              serve WebP, and emit a srcset, which matters because these are
              committed PNGs — the current one is a 1.9MB file that would
              otherwise ship whole as this page's LCP element.

              An absolute URL is author-supplied and remote. `next/image` would
              need the host in `remotePatterns`, and a story author adding an
              image must not have to edit `next.config.ts` to make it render, so
              that case stays a plain `<img>` — the same trade `StoryFigure` and
              the `img` rule in `storyComponentMap` make.

              Both are `priority`/`fetchPriority="high"` and never lazy: this is
              the story's LCP element, so deferring it defers the metric itself.
            */}
            {story.entry.frontmatter.heroImage.startsWith('/') ? (
              <Image
                src={story.entry.frontmatter.heroImage}
                alt={story.entry.frontmatter.heroImageAlt ?? ''}
                fill
                priority
                sizes="(max-width: 1280px) 100vw, 1280px"
                className="object-cover"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- remote author-supplied URL with no intrinsic size and no `remotePatterns` entry; see the note above. */
              <img
                src={story.entry.frontmatter.heroImage}
                /* Empty alt when the frontmatter omits one: the `<h1>` immediately
                   below already says what this is, and a screen reader repeating
                   the title as image text is noise, not description. */
                alt={story.entry.frontmatter.heroImageAlt ?? ''}
                decoding="async"
                fetchPriority="high"
                className="size-full object-cover"
              />
            )}
          </div>
        ) : null}
        <header className="space-y-4">
          <h1 className="type-page-title-large">{story.entry.frontmatter.title}</h1>
          <p className="type-page-subtitle">{story.entry.frontmatter.description}</p>
          {/*
            Byline. `author` is optional in frontmatter and falls back to the
            editorial team rather than rendering nothing: an article with no
            visible author reads as machine output, which is the opposite of
            what a story is for. The published date sits beside it because a
            byline without one invites "is this still true?".
          */}
          <p className="type-caption">
            {story.entry.frontmatter.author ?? t('byline')}
            {publishedLabel ? ` · ${publishedLabel}` : ''}
          </p>
        </header>
        {/*
          No `prose` classes: the Tailwind typography plugin is not installed,
          so they were inert. Story typography comes from the element map in
          `storyComponentMap` (src/lib/mdx/components.ts), built on the
          project's own `type-*` scale.
        */}
        {/*
          Embedded `<BrandCard>`s carry a save button, which reads `useSavedBrands`.
          The hook degrades to a no-op without a provider, so this is what makes the
          buttons live for signed-in readers while leaving signed-out ones untouched;
          the provider seeds itself from `getSavedBrandIdsAction` once a session exists.
          Scoped to the MDX body — nothing else on the page saves anything.
        */}
        <SavedBrandsProvider>
          <div>
            <StoryContent source={story.content} />
          </div>
        </SavedBrandsProvider>
        {story.entry.frontmatter.faq && story.entry.frontmatter.faq.length > 0 && (
          <FaqBlock questions={story.entry.frontmatter.faq} />
        )}
        {seriesId ? (
          <SeriesNav series={series} currentSlug={story.entry.slug} locale={safeLocale} />
        ) : null}
      </article>
    </main>
  )
}
