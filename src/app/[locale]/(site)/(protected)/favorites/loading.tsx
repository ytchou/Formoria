import { Skeleton } from '@/components/ui/skeleton'
import { BrandCardSkeleton } from '@/components/shared/brand-card-skeleton'
import { Grid } from '@/components/ui/grid'
import { PageShell } from '@/components/ui/page-shell'

export default function Loading() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-(--nav-height) z-10 border-b border-rule bg-ground/95 backdrop-blur">
        {/* Same shell as `page.tsx`: a different measure here reflows the row
          the moment the real page swaps in. */}
        <PageShell measure="page" className="flex h-14 items-center">
          <Skeleton className="h-5 w-32" />
        </PageShell>
      </header>
      <PageShell as="main" measure="page" className="py-8">
        <Grid>
          {Array.from({ length: 8 }).map((_, i) => (
            <BrandCardSkeleton key={i} />
          ))}
        </Grid>
      </PageShell>
    </div>
  )
}
