import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="page-gutter mx-auto max-w-screen-xl pt-10 pb-24 lg:pb-10">
      <div className="lg:grid lg:grid-cols-[580px_minmax(0,1fr)] lg:gap-10">
        {/* Image gallery skeleton */}
        <Skeleton className="aspect-square rounded-xl" />
        {/* Content stack skeleton */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-28 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
        </div>
      </div>
    </main>
  )
}
