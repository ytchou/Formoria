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
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-base font-semibold text-foreground">
        發生錯誤
      </p>
      <p className="mt-1 max-w-md text-sm text-[#7C7570]">
        載入此管理頁面時發生預期外的錯誤，請再試一次。
      </p>
      <Button
        onClick={reset}
        className="mt-6"
      >
        再試一次
      </Button>
    </div>
  )
}
