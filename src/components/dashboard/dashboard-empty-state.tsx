'use client'

import { Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export function DashboardEmptyState() {
  const t = useTranslations('dashboard.emptyState')

  return (
    <section className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
      <div className="mx-auto flex max-w-[480px] flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Lock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="mt-6 font-heading text-2xl font-bold text-foreground">
          {t('title')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t('description')}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-cta-foreground"
            href="/submit"
          >
            {t('submitCta')}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground"
            href="/brands"
          >
            {t('browseCta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
