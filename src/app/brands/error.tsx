'use client'

export default function BrandsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-col items-center justify-center px-6 py-24 text-center md:px-10">
      <p className="text-base font-semibold text-foreground">
        Something went wrong loading brands
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Try again
      </button>
    </main>
  )
}
