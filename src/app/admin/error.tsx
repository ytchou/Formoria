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
      <h1 className="type-page-title">Something went wrong</h1>
      <p className="mt-3 type-card-description">
        An unexpected error occurred while loading this admin page. Please try again.
      </p>
      <Button variant="primary" onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  )
}
