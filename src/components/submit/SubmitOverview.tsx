'use client'

import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type SubmitOverviewProps = {
  ownerPath?: string
  recommendPath?: string
  isLoggedIn?: boolean
}

export default function SubmitOverview({
  ownerPath = '/submit/owner',
  recommendPath = '/submit/recommend',
  isLoggedIn = false,
}: SubmitOverviewProps) {
  const t = useTranslations('submit.overview')
  const locale = useLocale()
  return (
    <main className="page-gutter mx-auto max-w-5xl py-20">
      <div className="max-w-3xl">
        <h1 className="text-balance type-page-title-large">
          {t('heading')}
        </h1>
        <p className="mt-4 type-body-muted">
          {t('description')}
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <p className="type-eyebrow-muted">
            {t('recommendEyebrow')}
          </p>
          <h2 className="mt-2 type-section-title-large text-foreground">
            {t('recommendTitle')}
          </h2>
          <p className="mt-3 type-card-description">
            {t('recommendDescription')}
          </p>
          <ul className="mt-5 space-y-2.5">
            {[t('recommendPoint1'), t('recommendPoint2'), t('recommendPoint3')].map(
              (point) => (
                <li
                  key={point}
                  className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-cta/25 bg-cta/10 text-cta"
                  >
                    <Check className="size-3" />
                  </span>
                  <span className="type-body-muted">{point}</span>
                </li>
              ),
            )}
          </ul>
          <Link
            href={recommendPath}
            className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-6')}
          >
            {t('recommendCta')}
          </Link>
        </section>

        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <p className="type-eyebrow-muted">
            {t('ownerEyebrow')}
          </p>
          <h2 className="mt-2 type-section-title-large text-foreground">
            {t('ownerTitle')}
          </h2>
          <p className="mt-3 type-card-description">
            {t('ownerDescription')}
          </p>
          <ul className="mt-5 space-y-2.5">
            {[t('ownerPoint1'), t('ownerPoint2'), t('ownerPoint3')].map(
              (point) => (
                <li
                  key={point}
                  className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-cta/25 bg-cta/10 text-cta"
                  >
                    <Check className="size-3" />
                  </span>
                  <span className="type-body-muted">{point}</span>
                </li>
              ),
            )}
          </ul>
          {isLoggedIn ? (
            <Link
              href={ownerPath}
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-6')}
            >
              {t('ownerCtaLoggedIn')}
            </Link>
          ) : (
            <NextLink
              href={signInHref(ownerPath, locale)}
              className={cn(buttonVariants({ variant: 'primary', tone: 'cta' }), 'mt-6')}
            >
              {t('ownerCta')}
            </NextLink>
          )}
        </section>
      </div>
    </main>
  )
}
