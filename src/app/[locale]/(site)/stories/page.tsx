import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { dateLocale } from '@/i18n/locale-preference'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { getAllStories, getStoriesByTag } from '@/lib/services/stories'
import type { StoryEntry } from '@/lib/services/stories'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { isStoryTag, STORY_TAGS } from '@/lib/taxonomy/story-tags'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

type PageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type SeriesGroup = {
  id: string
  title: string
  stories: StoryEntry[]
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

function formatStoryDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date))
}

/**
 * Splits the published list into series groups (rendered first, as titled
 * sections) and the remaining standalone entries. Group order follows first
 * appearance in the source list; members are ordered by `seriesOrder`, with
 * entries missing an order sinking to the end.
 */
function partitionBySeries(stories: StoryEntry[]): {
  series: SeriesGroup[]
  standalone: StoryEntry[]
} {
  const groups = new Map<string, SeriesGroup>()
  const standalone: StoryEntry[] = []

  for (const story of stories) {
    const seriesId = story.frontmatter.series
    if (!seriesId) {
      standalone.push(story)
      continue
    }

    const existing = groups.get(seriesId)
    if (existing) {
      existing.stories.push(story)
    } else {
      groups.set(seriesId, { id: seriesId, title: seriesId, stories: [story] })
    }
  }

  for (const group of groups.values()) {
    group.stories.sort(
      (a, b) =>
        (a.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.frontmatter.seriesOrder ?? Number.MAX_SAFE_INTEGER),
    )
    // Title comes from the earliest member that declares one, so the section
    // heading stays stable even if a later part omits `seriesTitle`.
    group.title =
      group.stories.find(entry => entry.frontmatter.seriesTitle)?.frontmatter.seriesTitle ??
      group.id
  }

  return { series: [...groups.values()], standalone }
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
        <p className="type-caption">
          {formatStoryDate(story.frontmatter.publishedAt, locale)}
        </p>
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
  const { series, standalone } = partitionBySeries(stories)

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
          <Link
            href="/stories"
            className={buttonVariants({ variant: activeTag === null ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
          >
            {t('allTags')}
          </Link>
          {STORY_TAGS.map((tag) => {
            const isActive = activeTag === tag

            return (
              <Link
                key={tag}
                href={`/stories?tag=${encodeURIComponent(tag)}`}
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
            {series.map((group, index) => {
              const headingId = `story-series-${index}`

              return (
                <section key={group.id} aria-labelledby={headingId} className="space-y-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={headingId} className="type-section-title">
                      {group.title}
                    </h2>
                    <p className="type-caption">
                      {t('seriesCount', { count: group.stories.length })}
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

            {standalone.length > 0 && (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {standalone.map((story) => (
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
