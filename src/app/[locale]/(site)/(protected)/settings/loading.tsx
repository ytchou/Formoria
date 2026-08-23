import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    // Same shell as `page.tsx`: a different measure here reflows the column the
    // moment the real page swaps in.
    <PageShell as="main" measure="form" className="py-section">
      <div className="space-y-stack">
        <Skeleton className="h-8 w-32" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-full rounded-surface" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-24 rounded-surface" />
      </div>
    </PageShell>
  )
}
