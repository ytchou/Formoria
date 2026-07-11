import { Skeleton } from '@/components/ui/skeleton'
import { BrandCardSkeleton } from '@/components/shared/brand-card-skeleton'

export default function Loading() {
  return (
    <main className="page-gutter mx-auto grid max-w-screen-xl gap-8 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="space-y-4">
        {/* Filter sidebar skeleton */}
        <Skeleton className="h-5 w-24" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-32" />
        ))}
      </div>
      <div>
        {/* Card grid skeleton */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <BrandCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </main>
  )
}
