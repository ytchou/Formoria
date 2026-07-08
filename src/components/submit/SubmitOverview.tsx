'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <div className="max-w-3xl">
        <h1 className="text-balance font-heading text-3xl font-bold text-foreground">
          {t('heading')}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-muted-foreground">
            {t('recommendEyebrow')}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            {t('recommendTitle')}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('recommendDescription')}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-foreground">
            <li>{t('recommendPoint1')}</li>
            <li>{t('recommendPoint2')}</li>
            <li>{t('recommendPoint3')}</li>
          </ul>
          <Link
            href={recommendPath}
            className={cn(buttonVariants({ variant: 'cta' }), 'mt-6')}
          >
            {t('recommendCta')}
          </Link>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-muted-foreground">
            {t('ownerEyebrow')}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            {t('ownerTitle')}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('ownerDescription')}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-foreground">
            <li>{t('ownerPoint1')}</li>
            <li>{t('ownerPoint2')}</li>
            <li>{t('ownerPoint3')}</li>
          </ul>
          <Link
            href={isLoggedIn ? ownerPath : `/auth/sign-in?next=${ownerPath}`}
            className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}
          >
            {isLoggedIn ? t('ownerCtaLoggedIn') : t('ownerCta')}
          </Link>
        </section>
      </div>
    </main>
  )
}
