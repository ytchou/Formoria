'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

type SubmitOverviewProps = {
  nextPath?: string;
};

export default function SubmitOverview({ nextPath = '/submit' }: SubmitOverviewProps) {
  const t = useTranslations('submit.overview')

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-heading text-3xl font-bold text-foreground">
        {t('heading')}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        {t('description')}
      </p>
      <ul className="mt-8 space-y-3">
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">1</span>
          <span className="text-sm text-foreground">{t('step1')}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">2</span>
          <span className="text-sm text-foreground">{t('step2')}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">3</span>
          <span className="text-sm text-foreground">{t('step3')}</span>
        </li>
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">{t('timeEstimate')}</p>
      <Link
        href={`/auth/sign-in?next=${nextPath}`}
        className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
      >
        {t('cta')}
      </Link>
    </main>
  );
}
