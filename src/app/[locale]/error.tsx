'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

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
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[#1A1918]">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm text-[#7C7570]">An unexpected error occurred. Please try again.</p>
      <button
        onClick={reset}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33] transition-colors"
      >
        Try again
      </button>
    </main>
  )
}
