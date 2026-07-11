export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="page-gutter mx-auto flex h-14 max-w-screen-xl items-center">
          <div className="h-5 w-32 rounded bg-muted animate-pulse" />
        </div>
      </header>
      <main className="page-gutter mx-auto max-w-screen-xl py-8">
        <div className="animate-pulse grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4 space-y-3">
              <div className="aspect-[4/3] rounded-lg bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
