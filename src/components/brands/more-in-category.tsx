import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface MoreInCategoryProps {
  category: string | null
  count: number
}

export function MoreInCategory({ category, count }: MoreInCategoryProps) {
  if (!category || count <= 0) return null

  return (
    <Link
      href={`/categories/${encodeURIComponent(category)}`}
      className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3.5 transition-colors hover:bg-secondary/80"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">
          More in {category}
        </p>
        <p className="text-xs text-muted-foreground">
          {count} other {count === 1 ? 'brand' : 'brands'} in this category
        </p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  )
}
