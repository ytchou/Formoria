import type { Metadata } from 'next'
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
import { toStoryIsoDate } from '@/components/stories/story-date'
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

  return {
    title: story.entry.frontmatter.title,
    description: story.entry.frontmatter.description,
    alternates: { canonical, languages },
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
  })
  // Both are omitted rather than emitted raw when the frontmatter date is
  // missing or unparseable: schema.org date properties must be ISO-8601, and an
  // empty (or JS `Date.toString()`) value is reported as invalid by Google.
  const datePublished = toStoryIsoDate(story.entry.frontmatter.publishedAt)
  const dateModified = toStoryIsoDate(story.entry.frontmatter.updatedAt)
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
    <main className="page-gutter mx-auto w-full max-w-[720px] py-12 md:py-16">
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
        <header className="space-y-4">
          <h1 className="type-page-title-large">{story.entry.frontmatter.title}</h1>
          <p className="type-page-subtitle">{story.entry.frontmatter.description}</p>
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
