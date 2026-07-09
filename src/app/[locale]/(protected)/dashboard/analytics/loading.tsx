import { surfaceCardStyles } from '@/components/ui/card'

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            className={surfaceCardStyles({ className: 'h-28', tone: 'white' })}
            key={item}
          >
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="mt-4 flex items-center gap-3">
              <div className="h-7 w-16 rounded bg-muted" />
              <div className="h-4 w-4 rounded-full bg-muted" />
            </div>
            <div className="mt-3 h-3 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className={surfaceCardStyles({ tone: 'white' })}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-4 w-36 rounded bg-muted" />
            <div className="h-4 w-48 rounded bg-muted" />
          </div>
          <div className="h-8 w-28 rounded-[8px] bg-muted" />
        </div>
        <div className="mt-6 h-52 rounded bg-muted" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((item) => (
          <div
            className={surfaceCardStyles({ tone: 'white' })}
            key={item}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-4 w-16 rounded bg-muted" />
            </div>
            <div className="mt-5 space-y-4">
              {[0, 1, 2].map((row) => (
                <div className="flex items-center gap-3" key={row}>
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-2 flex-1 rounded-full bg-muted" />
                  <div className="h-4 w-8 rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
