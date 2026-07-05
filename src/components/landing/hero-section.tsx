import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SplitHero from '@/components/shared/split-hero'

interface HeroSectionProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function HeroSection({ brandCount, categoryCount, recentBrands }: HeroSectionProps) {
  const t = await getTranslations('landing.hero')

  return (
    <SplitHero imageSrc="/images/hero-bg.png" eyebrow={t('eyebrow')} headline={t('headline')} subheadline={t('subheadline')}>
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
    </SplitHero>
  )
}
