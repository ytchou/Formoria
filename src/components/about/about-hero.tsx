import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'

interface AboutHeroProps {
  /** Omitted when the count could not be read — renders no figure rather than a false zero. */
  brandCount?: number
  /** Omitted when the count could not be read — renders no figure rather than a false zero. */
  categoryCount?: number
  recentBrands?: { count: number; period: '7d' | '30d' }
}

export default async function AboutHero({ brandCount, categoryCount, recentBrands }: AboutHeroProps) {
  const t = await getTranslations('about.hero')

  // Only the figures that are actually known are rendered, so no separator dangles.
  const facts: string[] = []
  if (brandCount != null) facts.push(`${brandCount} ${t('statsBrands')}`)
  if (categoryCount != null) facts.push(`${categoryCount} ${t('statsCategories')}`)

  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      <Image
        src="/images/hero-bg.webp"
        alt=""
        fill
        preload
        sizes="100vw"
        className="object-cover object-right"
      />
      <div className="absolute inset-0 bg-background/70 md:bg-background/45" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl page-gutter">
        <div className="max-w-3xl">
          <h1 className="type-hero text-balance">{t('title')}</h1>
          <p className="mt-3 max-w-2xl type-page-subtitle text-pretty">{t('subtitle')}</p>

          <div className="mt-6">
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
          </div>

          {(facts.length > 0 || (recentBrands != null && recentBrands.count > 0)) && (
            <p className="mt-6 type-metadata">
              {facts.join(' · ')}
              {recentBrands != null && recentBrands.count > 0 && (
                <span className="text-primary">
                  {facts.length > 0 ? ' · ' : ''}+{recentBrands.count}{' '}
                  {t(recentBrands.period === '7d' ? 'recentWeek' : 'recentMonth')}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
