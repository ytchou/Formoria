import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SplitHero from '@/components/shared/split-hero'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AboutHeroProps {
  brandCount: number
  categoryCount: number
  recentBrands: { count: number; period: '7d' | '30d' }
}

export default async function AboutHero({ brandCount, categoryCount, recentBrands }: AboutHeroProps) {
  const t = await getTranslations('landing.hero')

  return (
    <SplitHero imageSrc="/images/manifesto-bg.png" eyebrow={t('eyebrow')} headline={t('headline')} subheadline={t('subheadline')}>
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
            className={cn(buttonVariants({ variant: 'cta' }), 'mt-6')}
          >
            {t('cta')}
          </Link>
    </SplitHero>
  )
}
