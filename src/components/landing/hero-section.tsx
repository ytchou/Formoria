import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { SearchInput } from '@/components/brands/search-input'
import { buttonVariants } from '@/components/ui/button'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { cn } from '@/lib/utils'

interface HeroSectionProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function HeroSection({ brandCount, categoryCount, recentBrands }: HeroSectionProps) {
  const [t, locale] = await Promise.all([getTranslations('landing.hero'), getLocale()])

  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        priority
        loading="eager"
        sizes="100vw"
        className="object-cover object-right"
      />
      <div className="absolute inset-0 bg-background/70 md:bg-background/45" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl page-gutter">
        <h1 className="type-hero">{t('headline')}</h1>
        <p className="mt-3 type-page-subtitle max-w-2xl">{t('subheadline')}</p>

        <div className="mt-6 max-w-md rounded-lg bg-background/85">
          <SearchInput redirectTo="/brands" placeholder={t('cta')} />
        </div>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label={t('statsCategories')}>
          {PRODUCT_TYPE_CATEGORIES.map((cat) => (
            <Link
              key={cat.slug}
              href={`/brands?category=${cat.slug}`}
              // ui-exception: translucent hover border on hero, not in secondary variant; single site
              className={cn(
                buttonVariants({ variant: 'secondary', shape: 'pill', size: 'chip' }),
                'bg-background/80 text-muted-foreground hover:bg-background hover:border-foreground/30',
              )}
            >
              {categoryLabel(cat, locale)}
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
