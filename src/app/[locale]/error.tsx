'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useTranslations } from 'next-intl'

// This error boundary sits inside the locale layout, so the next-intl provider
// is already mounted. useTranslations is safe to call here.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors')

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="mx-auto flex max-w-screen-xl flex-col items-start px-6 py-24 md:px-10">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[#1A1918]">
        {t('boundary.title')}
      </h1>
      <p className="mt-3 text-sm text-[#7C7570]">{t('boundary.description')}</p>
      <button
        onClick={reset}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33] transition-colors"
      >
        {t('boundary.retry')}
      </button>
    </main>
  )
}
