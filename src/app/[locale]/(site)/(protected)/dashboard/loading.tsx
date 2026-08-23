import { PageShell } from '@/components/ui/page-shell'

export default function DashboardLoading() {
  return (
    // `gutter="none"`: the dashboard layout's `<main>` has already inset this,
    // and a second gutter here would inset the skeleton twice — so it would
    // sit narrower than the page it stands in for.
    <PageShell
      measure="page"
      gutter="none"
      className="grid gap-gutter lg:grid-cols-[400px_minmax(0,1fr)] animate-pulse"
    >
      <div className="w-full lg:w-[400px]">
        <div className="h-64 w-full rounded-surface bg-surface-deep lg:w-[400px]" />
      </div>

      <div className="min-w-0 space-y-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-3">
              <div className="h-7 w-56 rounded-surface bg-surface-deep" />
              <div className="flex flex-wrap gap-2">
                <div className="h-7 w-24 rounded-full bg-surface-deep" />
                <div className="h-7 w-28 rounded-full bg-surface-deep" />
              </div>
            </div>
            <div className="h-10 w-20 rounded-surface bg-surface-deep" />
          </div>

          <div className="prose-measure space-y-2">
            <div className="h-4 w-full rounded-surface bg-surface-deep" />
            <div className="h-4 w-11/12 rounded-surface bg-surface-deep" />
            <div className="h-4 w-2/3 rounded-surface bg-surface-deep" />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="h-7 w-20 rounded-full bg-surface-deep" />
            <div className="h-7 w-24 rounded-full bg-surface-deep" />
            <div className="h-7 w-16 rounded-full bg-surface-deep" />
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="h-4 w-24 rounded-surface bg-surface-deep" />
            <div className="h-4 w-16 rounded-surface bg-surface-deep" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-28 rounded-surface bg-surface-deep" />
            <div className="flex gap-2">
              <div className="h-7 w-20 rounded-full bg-surface-deep" />
              <div className="h-7 w-24 rounded-full bg-surface-deep" />
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
