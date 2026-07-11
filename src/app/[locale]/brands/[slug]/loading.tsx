export default function Loading() {
  return (
    <main className="page-gutter mx-auto max-w-screen-xl pt-10 pb-24 lg:pb-10">
      <div className="animate-pulse lg:grid lg:grid-cols-[580px_minmax(0,1fr)] lg:gap-10">
        {/* Image gallery skeleton */}
        <div className="aspect-square rounded-xl bg-muted" />
        {/* Content stack skeleton */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <div className="h-8 w-3/4 rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
            <div className="h-3 w-4/6 rounded bg-muted" />
          </div>
          <div className="flex gap-3">
            <div className="h-10 w-28 rounded-lg bg-muted" />
            <div className="h-10 w-28 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    </main>
  )
}
