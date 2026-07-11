'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="page-gutter mx-auto flex max-w-screen-xl flex-col items-center justify-center py-24 text-center">
      <h1 className="type-page-title">Something went wrong</h1>
      <p className="mt-3 type-card-description">
        An error occurred. Please try again.
      </p>
      <Button variant="primary" tone="cta" onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  )
}
