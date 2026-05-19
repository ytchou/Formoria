'use client'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error('[AdminError]', error)

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-base font-semibold text-foreground">
        Something went wrong
      </p>
      <p className="mt-1 max-w-md text-sm text-[#7C7570]">
        An unexpected error occurred while loading this admin page. Please try
        again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring/20"
      >
        Try Again
      </button>
    </div>
  )
}
