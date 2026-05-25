import Link from 'next/link'
import type { TaxonomyTag } from '@/lib/types'

interface ValueChipsProps {
  tags: TaxonomyTag[]
}

export default function ValueChips({ tags }: ValueChipsProps) {
  if (tags.length === 0) return null

  return (
    <section>
      <h2 className="mb-6 font-heading text-xl font-bold">依品牌價值瀏覽</h2>
      <div className="flex flex-wrap gap-3">
        {tags.map((tag) => (
          <Link
            key={tag.slug}
            href={`/brands?tags=${tag.slug}`}
            className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card"
          >
            {tag.nameZh ?? tag.name}
          </Link>
        ))}
      </div>
    </section>
  )
}
