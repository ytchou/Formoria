import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

interface HeroSectionProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function HeroSection({ brandCount, categoryCount, recentBrands }: HeroSectionProps) {
  const t = await getTranslations('landing.hero')

  return (
    <section className="grid lg:grid-cols-[2fr_3fr]">
      <div className="relative min-h-[20rem] lg:min-h-[32rem]">
        <Image
          src="/images/hero-bg.png"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover object-right"
        />
      </div>
      <div className="flex flex-col justify-center px-8 py-12 md:px-12 lg:py-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cta">
            {t('eyebrow')}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-foreground md:text-5xl">
            {t('headline')}
          </h1>
          <p className="mt-4 text-base leading-[1.7] text-muted-foreground">
            {t('subheadline')}
          </p>
          <div className="mt-6 flex items-start gap-6">
            <div>
              <p className="font-heading text-3xl font-bold text-foreground">{brandCount}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('statsBrands')}</p>
            </div>
            <div className="h-10 w-px bg-border" />
            <div>
              <p className="font-heading text-3xl font-bold text-foreground">{categoryCount}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('statsCategories')}</p>
            </div>
            {recentBrands.count > 0 ? (
              <>
                <div className="h-10 w-px bg-border" />
                <div>
                  <p className="font-heading text-3xl font-bold text-cta">+{recentBrands.count}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(recentBrands.period === '7d' ? 'recentWeek' : 'recentMonth')}</p>
                </div>
              </>
            ) : null}
          </div>
          <Link
            href="/brands"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            {t('cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
