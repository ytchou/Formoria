export default function HealthLoading() {
  return (
    <div className="h-64 animate-pulse rounded-xl border border-border bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="h-[72px] w-[72px] shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-5 w-36 rounded bg-muted" />
            <div className="h-6 w-20 rounded-full bg-muted" />
          </div>
          <div className="h-4 w-full max-w-md rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>

      <div className="mt-6 h-px w-full bg-muted" />

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="h-4 w-28 rounded bg-muted" />
          {[0, 1].map((item) => (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2" key={item}>
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-4 w-28 rounded bg-muted" />
              </div>
              <div className="h-3 w-10 rounded bg-muted" />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted" />
          {[0, 1, 2].map((item) => (
            <div className="space-y-2" key={item}>
              <div className="flex items-center justify-between gap-3">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-4 w-8 rounded bg-muted" />
              </div>
              <div className="h-2 w-full rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
