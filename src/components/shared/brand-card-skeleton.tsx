import { Skeleton } from '@/components/ui/skeleton'

export function BrandCardSkeleton() {
  return (
    <div className="space-y-3 rounded-surface border border-border p-4">
      <Skeleton className="aspect-media rounded-surface" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}
