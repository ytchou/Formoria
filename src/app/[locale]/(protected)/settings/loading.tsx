import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
    </main>
  )
}
