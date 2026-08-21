import { Skeleton } from '@/components/ui/skeleton'
import { BrandCardSkeleton } from '@/components/shared/brand-card-skeleton'
import { Grid } from '@/components/ui/grid'
import { PageShell } from '@/components/ui/page-shell'

export default function Loading() {
  return (
    <div className="min-h-screen bg-ground">
      <header className="sticky top-(--nav-height) z-10 border-b border-rule bg-ground/95 backdrop-blur">
        {/* THE MEASURE matches `page.tsx`, so the row no longer changes width
          when the real page swaps in. Only the measure. This header is `h-14`
          and sticky under the nav; `page.tsx`'s is `h-16` and static, so the
          swap still grows the row 8px and un-sticks it. That mismatch predates
          DEV-1529 and outlives it — closing it moves rendered layout, which is
          a behavioural change, not a width one. */}
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
