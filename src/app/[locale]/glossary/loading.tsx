export default function Loading() {
  return (
    <main className="page-gutter mx-auto max-w-6xl py-12 md:py-16">
      <div className="animate-pulse space-y-8">
        <div className="space-y-3">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-4 w-96 rounded bg-muted" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 w-28 rounded bg-muted" />
            ))}
          </div>
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-32 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-5/6 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
