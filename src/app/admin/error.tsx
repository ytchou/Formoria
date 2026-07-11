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

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <p className="type-card-title">
        發生錯誤
      </p>
      <p className="mt-1 max-w-md type-card-description">
        載入此管理頁面時發生預期外的錯誤，請再試一次。
      </p>
      <Button
        onClick={reset}
        className="mt-6"
      >
        再試一次
      </Button>
    </main>
  )
}
