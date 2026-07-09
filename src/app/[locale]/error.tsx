'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'

// Strings are hardcoded intentionally — an error boundary must never depend on
// the infrastructure (NextIntlClientProvider) it is trying to survive.
export default function Error({
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
    <main className="mx-auto flex max-w-screen-xl flex-col items-start px-6 py-24 md:px-10">
      <h1 className="type-page-title-large">
        Something went wrong
      </h1>
      <p className="mt-3 type-card-description">An unexpected error occurred. Please try again.</p>
      <Button
        variant="primary" tone="cta"
        onClick={reset}
        className="mt-6"
      >
        Try again
      </Button>
    </main>
  )
}
