import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

interface AboutHeroProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function AboutHero({ brandCount, categoryCount, recentBrands }: AboutHeroProps) {
  const [t, guideT] = await Promise.all([
    getTranslations('about.hero'),
    getTranslations('about.guide'),
  ])

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
        <div className="max-w-3xl">
          <h1 className="type-hero text-balance">{t('title')}</h1>
          <p className="mt-3 max-w-2xl type-page-subtitle text-pretty">{t('subtitle')}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/brands"
              className={buttonVariants({
                variant: 'primary',
                tone: 'cta',
                size: 'large',
                className: 'min-h-12',
              })}
            >
              {t('cta')}
            </Link>
            <Link
              href="/getting-started"
              className={buttonVariants({
                variant: 'secondary',
                size: 'large',
                className: 'min-h-12',
              })}
            >
              {guideT('cta')}
            </Link>
          </div>

          <p className="mt-6 type-metadata">
            {brandCount} {t('statsBrands')} · {categoryCount} {t('statsCategories')}
            {recentBrands.count > 0 && (
              <span className="text-primary">
                {' · '}+{recentBrands.count} {t(recentBrands.period === '7d' ? 'recentWeek' : 'recentMonth')}
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  )
}
