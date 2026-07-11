import { Skeleton } from '@/components/ui/skeleton'
import { BrandCardSkeleton } from '@/components/shared/brand-card-skeleton'

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="page-gutter mx-auto flex h-14 max-w-screen-xl items-center">
          <Skeleton className="h-5 w-32" />
        </div>
      </header>
      <main className="page-gutter mx-auto max-w-screen-xl py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <BrandCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  )
}
