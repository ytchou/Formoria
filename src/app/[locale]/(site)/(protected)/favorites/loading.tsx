import { Skeleton } from '@/components/ui/skeleton'
import { BrandCardSkeleton } from '@/components/shared/brand-card-skeleton'
import { Grid } from '@/components/ui/grid'

export default function Loading() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-(--nav-height) z-10 border-b border-rule bg-ground/95 backdrop-blur">
        <div className="page-gutter mx-auto flex h-14 page-measure items-center">
          <Skeleton className="h-5 w-32" />
        </div>
      </header>
      <main className="page-gutter mx-auto page-measure py-8">
        <Grid>
          {Array.from({ length: 8 }).map((_, i) => (
            <BrandCardSkeleton key={i} />
          ))}
        </Grid>
      </main>
    </div>
  )
}
