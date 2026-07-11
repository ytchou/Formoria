export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-12 w-full rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div className="h-10 w-24 rounded-lg bg-muted" />
      </div>
    </main>
  )
}
