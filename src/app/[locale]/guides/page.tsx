import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { dateLocale } from '@/i18n/locale-preference'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { getAllGuides, getGuidesByCategory } from '@/lib/services/guides'
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
  const t = await getTranslations({ locale, namespace: 'guides' })
  const { canonical, languages } = buildAlternates('/guides', safeLocale)

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical, languages },
  }
}

function formatGuideDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date))
}

export default async function GuidesHubPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'guides' })
  const sp = await searchParams
  const category = typeof sp.category === 'string' && sp.category.trim() ? sp.category.trim() : null
  const activeCategory = category && PRODUCT_TYPE_CATEGORIES.some((item) => item.slug === category)
    ? category
    : null
  const guideResult = activeCategory ? await getGuidesByCategory(activeCategory) : await getAllGuides()
  const guides = guideResult.ok ? guideResult.guides : []

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

        <nav aria-label="Guide categories" className="flex flex-wrap gap-2">
          <Link
            href="/guides"
            className={buttonVariants({ variant: activeCategory === null ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
          >
            {t('allCategories')}
          </Link>
          {PRODUCT_TYPE_CATEGORIES.map((item) => {
            const isActive = activeCategory === item.slug

            return (
              <Link
                key={item.slug}
                href={`/guides?category=${encodeURIComponent(item.slug)}`}
                className={buttonVariants({ variant: isActive ? 'primary' : 'secondary', shape: 'pill', size: 'chip' })}
              >
                {categoryLabel(item, locale)}
              </Link>
            )
          })}
        </nav>

        {!guideResult.ok ? (
          <div
            role="alert"
            className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-secondary px-6 py-16 text-center"
          >
            <p className="type-empty-title">{t('loadError')}</p>
          </div>
        ) : guides.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border bg-secondary px-6 py-16 text-center">
            <p className="type-empty-body">{t('comingSoon')}</p>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {guides.map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className={surfaceCardStyles({
                  className: 'group hover:bg-secondary',
                  interactive: true,
                })}
              >
                <div className="space-y-3">
                  <div className="space-y-2">
                    <h2 className="type-card-title group-hover:underline">
                      {guide.frontmatter.title}
                    </h2>
                    <p className="type-body-muted">
                      {guide.frontmatter.description}
                    </p>
                  </div>
                  <p className="type-caption">
                    {formatGuideDate(guide.frontmatter.publishedAt, locale)}
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
