'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { inkActionClassName } from '@/components/admin/ink-action'
import { cn } from '@/lib/utils'
import * as Sentry from '@sentry/nextjs'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('admin.common')

  useEffect(() => {
    Sentry.captureException(error)
    console.error('[AdminError]', error)
  }, [error])

  return (
    <main className="page-gutter mx-auto flex page-measure flex-col items-center justify-center py-section text-center">
      <h1 className="type-section">{t('error.title')}</h1>
      <p className="mt-3 type-body-sm">{t('error.description')}</p>
      <Button
        variant="secondary"
        onClick={reset}
        className={cn('mt-6', inkActionClassName)}
      >
        {t('error.retry')}
      </Button>
    </main>
  )
}
