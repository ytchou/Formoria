'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import * as Sentry from '@sentry/nextjs'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    console.error('[AdminError]', error)
  }, [error])

  // Admin sits outside the [locale] tree (no NextIntlClientProvider), so this
  // boundary stays self-contained with zh literals; layout mirrors RouteError.
  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <h1 className="type-page-title">發生錯誤</h1>
      <p className="mt-3 type-card-description">
        載入此管理頁面時發生預期外的錯誤，請再試一次。
      </p>
      <Button variant="primary" onClick={reset} className="mt-6">
        再試一次
      </Button>
    </main>
  )
}
