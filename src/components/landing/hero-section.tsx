import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { SearchInput } from '@/components/brands/search-input'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

interface HeroSectionProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function HeroSection({ brandCount, categoryCount, recentBrands }: HeroSectionProps) {
  const t = await getTranslations('landing.hero')

  return (
    <section className="py-12 md:py-20">
      <div className="mx-auto max-w-6xl page-gutter">
        <h1 className="type-hero">{t('headline')}</h1>
        <p className="mt-3 type-page-subtitle max-w-2xl">{t('subheadline')}</p>

        <div className="mt-6 max-w-md">
          <SearchInput placeholder={t('cta')} />
        </div>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label={t('statsCategories')}>
          {PRODUCT_TYPE_CATEGORIES.map((cat) => (
            <Link
              key={cat.slug}
              href={`/brands?category=${cat.slug}`}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-transparent px-3 py-1 type-micro text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {cat.nameZh}
            </Link>
          ))}
        </nav>

        <p className="mt-6 type-metadata">
          {brandCount} {t('statsBrands')} · {categoryCount} {t('statsCategories')}
          {recentBrands.count > 0 && (
            <span className="text-primary"> · +{recentBrands.count} {t(recentBrands.period === '7d' ? 'recentWeek' : 'recentMonth')}</span>
          )}
        </p>
      </div>
    </section>
  )
}
