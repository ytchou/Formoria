export default function DashboardLoading() {
  return (
    <div className="grid max-w-[1240px] gap-8 lg:grid-cols-[400px_minmax(0,1fr)] animate-pulse">
      <div className="w-full lg:w-[400px]">
        <div className="h-64 w-full rounded-xl bg-muted lg:w-[400px]" />
      </div>

      <div className="min-w-0 space-y-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-3">
              <div className="h-7 w-56 rounded bg-muted" />
              <div className="flex flex-wrap gap-2">
                <div className="h-7 w-24 rounded-full bg-muted" />
                <div className="h-7 w-28 rounded-full bg-muted" />
              </div>
            </div>
            <div className="h-10 w-20 rounded-[8px] bg-muted" />
          </div>

          <div className="max-w-3xl space-y-2">
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-11/12 rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="h-7 w-20 rounded-full bg-muted" />
            <div className="h-7 w-24 rounded-full bg-muted" />
            <div className="h-7 w-16 rounded-full bg-muted" />
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="flex gap-2">
              <div className="h-7 w-20 rounded-full bg-muted" />
              <div className="h-7 w-24 rounded-full bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
