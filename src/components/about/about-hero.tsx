import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { routes } from '@/lib/routes'

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
    /*
      NO BACKGROUND PHOTOGRAPH, AND DO NOT PUT ONE BACK.

      This band used to be a full-bleed stock image under a 70%/45% paper scrim.
      Two costs, both real: the scrim was the only thing making the title legible,
      so contrast depended on an image nobody re-checked when it changed; and a
      decorative photo behind an editorial statement is exactly the generic
      surface v2 exists to remove. The opening is the sentence, on paper.
    */
    <section className="py-section">
      <div className="mx-auto max-w-6xl page-gutter">
        <div className="max-w-3xl">
          <h1 className="type-display text-balance">{t('title')}</h1>
          <p className="mt-4 max-w-2xl type-body text-ink-soft text-pretty">{t('subtitle')}</p>

          <div className="mt-6">
            <Link
              href={routes.brands()}
              className={buttonVariants({
                variant: 'primary',
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
                <span className="text-accent">
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
