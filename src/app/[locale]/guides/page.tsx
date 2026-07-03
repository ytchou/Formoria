import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getAllGuides, getGuidesByCategory } from '@/lib/services/guides'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

type PageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export const revalidate = 3600

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'guides' })

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  }
}

function formatGuideDate(date: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
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
  const guides = activeCategory ? await getGuidesByCategory(activeCategory) : await getAllGuides()

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-8">
        <header className="space-y-3">
          <p className="font-sans text-sm uppercase tracking-[0.18em] text-muted-foreground">
            {t('badgeLabel')}
          </p>
          <h1 className="font-heading text-[26px] font-bold text-foreground">{t('heading')}</h1>
          <p className="max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
            {t('subheading')}
          </p>
        </header>

        <nav aria-label="Guide categories" className="flex flex-wrap gap-2">
          <Link
            href="/guides"
            className={`rounded-full border px-3.5 py-1.5 font-sans text-sm transition-colors ${
              activeCategory === null
                ? 'border-stone-950 bg-stone-950 text-white'
                : 'border-stone-200 text-stone-700 hover:bg-stone-100'
            }`}
          >
            {t('allCategories')}
          </Link>
          {PRODUCT_TYPE_CATEGORIES.map((item) => {
            const isActive = activeCategory === item.slug

            return (
              <Link
                key={item.slug}
                href={`/guides?category=${encodeURIComponent(item.slug)}`}
                className={`rounded-full border px-3.5 py-1.5 font-sans text-sm transition-colors ${
                  isActive
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-200 text-stone-700 hover:bg-stone-100'
                }`}
              >
                {item.nameZh}
              </Link>
            )
          })}
        </nav>

        {guides.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 px-6 py-16 text-center">
            <p className="font-sans text-sm text-stone-600">coming soon</p>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {guides.map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className="group rounded-xl border border-stone-200 bg-stone-50 p-5 transition-colors hover:bg-stone-100"
              >
                <div className="space-y-3">
                  <div className="space-y-2">
                    <h2 className="font-heading text-lg font-semibold text-foreground group-hover:underline">
                      {guide.frontmatter.title}
                    </h2>
                    <p className="font-sans text-sm leading-[1.7] text-stone-600">
                      {guide.frontmatter.description}
                    </p>
                  </div>
                  <p className="font-sans text-xs text-stone-500">
                    {formatGuideDate(guide.frontmatter.publishedAt)}
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
