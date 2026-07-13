import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'

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
        src="/images/manifesto-bg.png"
        alt=""
        fill
        priority
        loading="eager"
        sizes="100vw"
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-background/75 md:bg-background/60" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl page-gutter">
        <div className="max-w-3xl">
          <p className="type-eyebrow-cta" translate="no">{t('eyebrow')}</p>
          <h1 className="mt-4 type-hero text-balance">{t('title')}</h1>
          <p className="mt-4 max-w-2xl type-page-subtitle text-pretty">{t('subtitle')}</p>

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

          <SurfaceCard
            tone="background"
            padding="sm"
            className="mt-8 max-w-xl bg-background/85 backdrop-blur-sm"
          >
            <dl className="flex flex-wrap gap-y-4 divide-x divide-border">
              <div className="flex min-w-24 flex-col-reverse px-4 first:pl-0">
                <dt className="mt-0.5 type-caption">{t('statsBrands')}</dt>
                <dd className="type-stat tabular-nums">{brandCount}</dd>
              </div>
              <div className="flex min-w-24 flex-col-reverse px-4">
                <dt className="mt-0.5 type-caption">{t('statsCategories')}</dt>
                <dd className="type-stat tabular-nums">{categoryCount}</dd>
              </div>
              {recentBrands.count > 0 ? (
                <div className="flex min-w-24 flex-col-reverse px-4 last:pr-0">
                  <dt className="mt-0.5 type-caption">
                    {t(recentBrands.period === '7d' ? 'recentWeek' : 'recentMonth')}
                  </dt>
                  <dd className="type-stat tabular-nums text-cta">+{recentBrands.count}</dd>
                </div>
              ) : null}
            </dl>
          </SurfaceCard>
        </div>
      </div>
    </section>
  )
}
