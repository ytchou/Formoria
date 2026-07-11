import { surfaceCardStyles } from '@/components/ui/card'

export default function Loading() {
  return (
    <main className="page-gutter mx-auto w-full max-w-5xl py-8 md:py-12">
      <div className="animate-pulse space-y-12">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-32 rounded bg-muted" />
          <div className="mx-auto h-4 w-48 rounded bg-muted" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={surfaceCardStyles({ tone: 'white', className: 'space-y-4' })}>
            <div className="h-5 w-36 rounded bg-muted" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-3 w-12 rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
