export default function Loading() {
  return (
    <main className="page-gutter mx-auto grid max-w-screen-xl gap-8 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="animate-pulse space-y-4">
        {/* Filter sidebar skeleton */}
        <div className="h-5 w-24 rounded bg-muted" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 w-32 rounded bg-muted" />
        ))}
      </div>
      <div className="animate-pulse">
        {/* Card grid skeleton */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4 space-y-3">
              <div className="aspect-[4/3] rounded-lg bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
