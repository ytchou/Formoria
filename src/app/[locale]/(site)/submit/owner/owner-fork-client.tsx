'use client'

import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

export default function OwnerForkClient() {
  const t = useTranslations('submit')

  return (
    <main className="page-gutter mx-auto max-w-5xl py-20">
      <div className="max-w-3xl">
        <h1 className="text-balance type-page-title">
          {t('ownerFork.heading')}
        </h1>
        <p className="mt-4 type-body-sm">
          {t('ownerFork.description')}
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <h2 className="type-section text-foreground">
            {t('ownerFork.quickTitle')}
          </h2>
          <p className="mt-3 type-body-sm">
            {t('ownerFork.quickDescription')}
          </p>
          <ul className="mt-5 space-y-2.5">
            {[
              t('ownerFork.quickPoint1'),
              t('ownerFork.quickPoint2'),
              t('ownerFork.quickPoint3'),
            ].map((point) => (
              <li
                key={point}
                className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent"
                >
                  <Check className="size-3" />
                </span>
                <span className="type-body-sm">{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href={routes.submit.ownerQuick()}
            className={cn(buttonVariants({ variant: 'primary' }), 'mt-6')}
          >
            {t('ownerFork.quickCta')}
          </Link>
        </section>

        <section className={surfaceCardStyles({ padding: 'lg' })}>
          <h2 className="type-section text-foreground">
            {t('ownerFork.detailsTitle')}
          </h2>
          <p className="mt-3 type-body-sm">
            {t('ownerFork.detailsDescription')}
          </p>
          <ul className="mt-5 space-y-2.5">
            {[
              t('ownerFork.detailsPoint1'),
              t('ownerFork.detailsPoint2'),
              t('ownerFork.detailsPoint3'),
            ].map((point) => (
              <li
                key={point}
                className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent"
                >
                  <Check className="size-3" />
                </span>
                <span className="type-body-sm">{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href={routes.submit.ownerDetails()}
            className={cn(buttonVariants({ variant: 'primary' }), 'mt-6')}
          >
            {t('ownerFork.detailsCta')}
          </Link>
        </section>
      </div>
    </main>
  )
}
