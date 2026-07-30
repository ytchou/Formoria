import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { dateLocale } from '@/i18n/locale-preference'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { getAllStories, getStoriesByCategory } from '@/lib/services/stories'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
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

function formatStoryDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date))
}

export default async function StoriesHubPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({ locale, namespace: 'stories' })
  const sp = await searchParams
  const category = typeof sp.category === 'string' && sp.category.trim() ? sp.category.trim() : null
  const activeCategory = category && PRODUCT_TYPE_CATEGORIES.some((item) => item.slug === category)
    ? category
    : null
  const storyResult = activeCategory
    ? await getStoriesByCategory(activeCategory, safeLocale)
    : await getAllStories(safeLocale)
  const stories = storyResult.ok ? storyResult.stories : []

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

        <nav aria-label={t('categoriesAria')} className="flex flex-wrap gap-2">
          <Link
            href="/stories"
            className={buttonVariants({ variant: activeCategory === null ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
          >
            {t('allCategories')}
          </Link>
          {PRODUCT_TYPE_CATEGORIES.map((item) => {
            const isActive = activeCategory === item.slug

            return (
              <Link
                key={item.slug}
                href={`/stories?category=${encodeURIComponent(item.slug)}`}
                className={buttonVariants({ variant: isActive ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
              >
                {categoryLabel(item, locale)}
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
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stories.map((story) => (
              <Link
                key={story.slug}
                href={`/stories/${story.slug}`}
                className={surfaceCardStyles({
                  className: 'group hover:bg-secondary',
                  interactive: true,
                })}
              >
                <div className="space-y-3">
                  <div className="space-y-2">
                    <h2 className="type-card-title group-hover:underline">
                      {story.frontmatter.title}
                    </h2>
                    <p className="type-body-muted">
                      {story.frontmatter.description}
                    </p>
                  </div>
                  <p className="type-caption">
                    {formatStoryDate(story.frontmatter.publishedAt, locale)}
                  </p>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  )
}
