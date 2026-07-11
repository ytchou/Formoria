export default function Loading() {
  return (
    <main className="page-gutter mx-auto w-full max-w-[720px] py-12 md:py-16">
      <div className="animate-pulse space-y-8">
        <div className="space-y-4">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-10 w-5/6 rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
        </div>
        <div className="space-y-3">
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-5/6 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-4/6 rounded bg-muted" />
        </div>
        <div className="space-y-3">
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-3/4 rounded bg-muted" />
        </div>
      </div>
    </main>
  )
}
