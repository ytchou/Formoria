import { ChevronRight } from 'lucide-react'
import type { AppLocale } from '@/i18n/locale-preference'
import { localizePath } from '@/i18n/locale-preference'
import { routes } from '@/lib/routes'

export type DirectoryBreadcrumbItem = {
  label: string
  href?: string
  current?: boolean
}
export type DirectoryBreadcrumbInput = {
  locale: AppLocale
  directoryLabel: string
  category?: { slug: string; label: string } | null
  subcategory?: { slug: string; label: string } | null
}

export function buildDirectoryBreadcrumbItems({
  locale,
  directoryLabel,
  category,
  subcategory,
}: DirectoryBreadcrumbInput): DirectoryBreadcrumbItem[] {
  if (!category && !subcategory) return []

  const categoryPath = category ? routes.category(category.slug) : null
  const items: DirectoryBreadcrumbItem[] = [
    { label: directoryLabel, href: localizePath(routes.brands(), locale) },
  ]

  if (category) {
    items.push({
      label: category.label,
      ...(subcategory
        ? { href: localizePath(categoryPath ?? routes.categories(), locale) }
        : { current: true }),
    })
  }

  if (subcategory && category) {
    items.push({
      label: subcategory.label,
      current: true,
    })
  }

  return items
}

export function DirectoryBreadcrumb({
  ariaLabel,
  ...input
}: DirectoryBreadcrumbInput & { ariaLabel: string }) {
  const items = buildDirectoryBreadcrumbItems(input)
  if (items.length === 0) return null

  return (
    <nav aria-label={ariaLabel} className="mb-6">
      <ol className="flex items-center gap-1.5 type-body-sm">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            ) : null}
            {item.current || !item.href ? (
              <span aria-current={item.current ? 'page' : undefined} className={item.current ? 'font-medium text-foreground' : undefined}>
                {item.label}
              </span>
            ) : (
              <a href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
