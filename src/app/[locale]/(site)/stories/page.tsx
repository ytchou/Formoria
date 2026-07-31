import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatStoryDate } from '@/components/stories/story-date'
import { getAllStories, getStoriesByTag, groupStoriesBySeries } from '@/lib/services/stories'
import type { StoryEntry } from '@/lib/services/stories'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { isStoryTag, STORY_TAGS } from '@/lib/taxonomy/story-tags'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

type PageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export const revalidate = 3600

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({ locale, namespace: 'stories' })
  const { canonical, languages } = buildAlternates('/stories', safeLocale)

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical, languages },
  }
}

function StoryCard({
  story,
  locale,
  headingLevel,
}: {
  story: StoryEntry
  locale: string
  headingLevel: 2 | 3
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  // `null` for a story whose frontmatter carries no usable `publishedAt` — the
  // card drops its date line rather than throwing out of the server component
  // and taking the whole hub with it.
  const publishedLabel = formatStoryDate(story.frontmatter.publishedAt, locale)

  return (
    <Link
      href={`/stories/${story.slug}`}
      className={surfaceCardStyles({
        className: 'group hover:bg-secondary',
        interactive: true,
      })}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Heading className="type-card-title group-hover:underline">
            {story.frontmatter.title}
          </Heading>
          <p className="type-body-muted">
            {story.frontmatter.description}
          </p>
        </div>
        {publishedLabel ? <p className="type-caption">{publishedLabel}</p> : null}
      </div>
    </Link>
  )
}

export default async function StoriesHubPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({ locale, namespace: 'stories' })
  const sp = await searchParams
  const requestedTag = typeof sp.tag === 'string' && sp.tag.trim() ? sp.tag.trim() : null
  const activeTag = requestedTag && isStoryTag(requestedTag) ? requestedTag : null
  const storyResult = activeTag
    ? await getStoriesByTag(activeTag, safeLocale)
    : await getAllStories(safeLocale)
  const stories = storyResult.ok ? storyResult.stories : []
  // Grouping and ordering live in the service (`groupStoriesBySeries`), which is
  // also what `getStorySeries` orders by — one definition of "series order", not
  // one here and one there.
  const { series, standalone } = groupStoriesBySeries(stories, safeLocale)
  // A group down to a single visible entry gets no titled section, matching
  // `SeriesNav`, which renders nothing below two members. Its story still shows
  // — it just joins the ungrouped grid instead of sitting alone under a heading.
  const seriesSections = series.filter((group) => group.stories.length >= 2)
  const ungrouped: StoryEntry[] = [
    ...series.filter((group) => group.stories.length < 2).flatMap((group) => group.stories),
    ...standalone,
  ]

  // Product-type tags share the brand ontology's labels; editorial tags have no
  // ontology entry and read their label from the `stories.tags.*` messages.
  const tagLabel = (tag: string): string => {
    const productType = PRODUCT_TYPE_CATEGORIES.find(item => item.slug === tag)
    return productType ? categoryLabel(productType, locale) : t(`tags.${tag}`)
  }

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <div className="space-y-8">
        <header className="space-y-3">
          <p className="type-eyebrow-muted">
            {t('badgeLabel')}
          </p>
          <h1 className="type-page-title">{t('heading')}</h1>
          <p className="max-w-2xl type-body-muted">
            {t('subheading')}
          </p>
        </header>

        <nav aria-label={t('tagsAria')} className="flex flex-wrap gap-2">
          {/*
            `aria-current` carries the active state, matching the project's
            canonical filter-chip nav (`components/feedback/feature-request-filters`).
            The `primary` fill alone is colour-only signalling: invisible to a
            screen reader and unreliable in forced-colours mode.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- DEV-1280: full-document navigation avoids a stalled RSC request across the locale proxy rewrite. */}
          <a
            href="/stories"
            aria-current={activeTag === null ? 'page' : undefined}
            className={buttonVariants({ variant: activeTag === null ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
          >
            {t('allTags')}
          </a>
          {STORY_TAGS.map((tag) => {
            const isActive = activeTag === tag

            return (
              <Link
                key={tag}
                href={`/stories?tag=${encodeURIComponent(tag)}`}
                aria-current={isActive ? 'page' : undefined}
                className={buttonVariants({ variant: isActive ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
              >
                {tagLabel(tag)}
              </Link>
            )
          })}
        </nav>

        {!storyResult.ok ? (
          <div
            role="alert"
            className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-secondary px-6 py-16 text-center"
          >
            <p className="type-empty-title">{t('loadError')}</p>
          </div>
        ) : stories.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-secondary px-6 py-16 text-center">
            <p className="type-empty-body">{t('comingSoon')}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {seriesSections.map((group, index) => {
              const headingId = `story-series-${index}`
              // Under a tag filter the visible members are a subset of the
              // series, so a bare count contradicts `SeriesNav` on the detail
              // page, which always reports the full series. Say "N of M" instead.
              const isPartial = group.stories.length !== group.totalCount

              return (
                <section key={group.id} aria-labelledby={headingId} className="space-y-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={headingId} className="type-section-title">
                      {group.title}
                    </h2>
                    <p className="type-caption">
                      {isPartial
                        ? t('seriesCountFiltered', {
                            shown: group.stories.length,
                            total: group.totalCount,
                          })
                        : t('seriesCount', { count: group.stories.length })}
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.stories.map((story) => (
                      <StoryCard
                        key={story.slug}
                        story={story}
                        locale={locale}
                        headingLevel={3}
                      />
                    ))}
                  </div>
                </section>
              )
            })}

            {ungrouped.length > 0 && (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {ungrouped.map((story) => (
                  <StoryCard
                    key={story.slug}
                    story={story}
                    locale={locale}
                    headingLevel={2}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
