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

  const categoryPath = category ? routes.brands({ category: category.slug }) : null
  const items: DirectoryBreadcrumbItem[] = [
    { label: directoryLabel, href: localizePath(routes.brands(), locale) },
  ]

  if (category) {
    items.push({
      label: category.label,
      ...(subcategory
        ? { href: localizePath(categoryPath ?? routes.brands(), locale) }
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
