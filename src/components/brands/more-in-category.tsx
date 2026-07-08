import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'

interface MoreInCategoryProps {
  category: string | null
  categoryLabel?: string | null
  count: number
}

export async function MoreInCategory({ category, categoryLabel, count }: MoreInCategoryProps) {
  if (!category || count <= 0) return null

  const t = await getTranslations('brandDetail')
  const displayLabel = categoryLabel ?? category

  return (
    <Link
      href={`/brands?category=${encodeURIComponent(category)}`}
      className="flex items-center justify-between rounded-xl bg-card border border-border px-4 py-3.5 transition-colors hover:border-foreground/20"
    >
      <div className="space-y-0.5">
        <p className="type-subsection-title">
          {t('moreInCategory.heading', { category: displayLabel })}
        </p>
        <p className="type-caption">
          {t('moreInCategory.subtext', { count })}
        </p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  )
}
