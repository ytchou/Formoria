import { listIndexableTargets } from '@/lib/seo/directory-indexation'
import { categoryLabel, subcategoryBySlug } from '@/lib/taxonomy/ontology'
import { localizePath } from '@/i18n/locale-preference'
import { taxonomyLinkClasses } from '@/components/ui/toggle-chip'
import type { Locale } from '@/lib/seo/alternates'

type CategoryLinkListProps = {
  locale: Locale
  category: { slug: string; label: string } | null
  ariaLabel: string
}

export function CategoryLinkList({
  ariaLabel,
  category,
  locale,
}: CategoryLinkListProps) {
  if (!category) return null

  const childTargets = listIndexableTargets().filter(
    (target) => target.categorySlug === category.slug && target.subcategorySlug,
  )

  if (childTargets.length === 0) return null

  return (
    <nav aria-label={ariaLabel} className="mt-5">
      <ul className="flex flex-wrap gap-2">
        {childTargets.map((target) => {
          const subcategory = target.subcategorySlug
            ? subcategoryBySlug(target.subcategorySlug)
            : null
          if (!subcategory) return null

          const subcategoryLabel = categoryLabel(
            {
              name: subcategory.nameEn,
              nameZh: subcategory.nameZh,
            },
            locale,
          )
          const linkLabel = locale === 'zh-TW'
            ? `${category.label}・${subcategoryLabel}`
            : `${category.label}: ${subcategoryLabel}`

          return (
            <li key={target.subcategorySlug}>
              <a
                href={localizePath(`/categories/${category.slug}/${subcategory.slug}`, locale)}
                className={taxonomyLinkClasses()}
              >
                {linkLabel}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
