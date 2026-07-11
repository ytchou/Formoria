'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type RouteErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
  titleKey?: string
  descriptionKey?: string
  titleClassName?: string
}

export function RouteError({
  error,
  reset,
  titleKey = 'boundary.title',
  descriptionKey = 'boundary.description',
  titleClassName = 'type-page-title',
}: RouteErrorProps) {
  const t = useTranslations('errors')

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <h1 className={titleClassName}>{t(titleKey)}</h1>
      <p className="mt-3 type-card-description">{t(descriptionKey)}</p>
      <Button variant="primary" tone="cta" onClick={reset} className="mt-6">
        {t('boundary.retry')}
      </Button>
    </main>
  )
}
