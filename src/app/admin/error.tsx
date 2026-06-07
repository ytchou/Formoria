'use client'

import { useEffect } from 'react'
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-base font-semibold text-foreground">
        發生錯誤
      </p>
      <p className="mt-1 max-w-md text-sm text-[#7C7570]">
        載入此管理頁面時發生預期外的錯誤，請再試一次。
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring/20"
      >
        再試一次
      </button>
    </div>
  )
}
