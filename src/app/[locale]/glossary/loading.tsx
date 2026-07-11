import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="page-gutter mx-auto max-w-6xl py-12 md:py-16">
      <div className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-28" />
            ))}
          </div>
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
