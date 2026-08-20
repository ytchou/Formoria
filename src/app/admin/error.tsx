'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
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
    // `prose`, as at every other error boundary. `gutter="none"` because this
    // boundary renders inside `admin/layout.tsx`'s `<main>`, which has already
    // inset it — a second gutter here would inset the message twice.
    <PageShell
      as="main"
      measure="prose"
      gutter="none"
      className="flex flex-col items-center justify-center py-section text-center"
    >
      <h1 className="type-section">{t('error.title')}</h1>
      <p className="mt-3 type-body-sm">{t('error.description')}</p>
      <Button
        variant="secondary"
        onClick={reset}
        className={cn('mt-6', inkActionClassName)}
      >
        {t('error.retry')}
      </Button>
    </PageShell>
  )
}
