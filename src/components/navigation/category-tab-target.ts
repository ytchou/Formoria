import { localizePath } from '@/i18n/locale-preference'
import {
  DIRECTORY_REFINEMENT_KEYS,
  DIRECTORY_SORT_KEY,
  updateDirectoryUrl,
} from '@/lib/directory-filter-url'
import { L1_CATEGORIES } from '@/lib/taxonomy/ontology'
import { routes } from '@/lib/routes'

export type CategoryTabTargetInput = {
  pathname: string
  searchParams: string
  slug: string
  subSlug?: string | null
  categorySlugs?: string[]
  locale: string
}

export type CategoryTabTarget = {
  routerPath: string
  href: string
}

export function buildCategoryTabTarget({
  pathname,
  searchParams,
  slug,
  subSlug,
  categorySlugs,
  locale,
}: CategoryTabTargetInput): CategoryTabTarget {
  const params = new URLSearchParams(searchParams)
  const selectedCategories = categorySlugs ?? (slug ? [slug] : [])
  const clearingAll = slug === '' && categorySlugs === undefined
  const validCategories = selectedCategories.filter((candidate) =>
    L1_CATEGORIES.some((category) => category.slug === candidate),
  )
  const categorySlug = validCategories[0] ?? null
  const activeSubSlug = subSlug ?? null
  const hasFacet = [...DIRECTORY_REFINEMENT_KEYS, DIRECTORY_SORT_KEY].some((key) => {
    const value = params.get(key)
    return typeof value === 'string' && value.trim().length > 0
  })
  const subValues = activeSubSlug
    ? activeSubSlug.split(',').map((item) => item.trim()).filter(Boolean)
    : []
  let routerPath: string
  if (!categorySlug) {
    routerPath = !clearingAll && hasFacet
      ? updateDirectoryUrl(routes.brands(), params, { category: null, sub: null })
      : routes.brands()
  } else {
    const nextCategory = validCategories.join(',')
    routerPath = updateDirectoryUrl(routes.brands(), params, {
      category: nextCategory,
      sub: subValues.length > 0 ? subValues.join(',') : null,
    })
  }

  // `pathname` is part of the contract so callers can use this resolver for
  // every surface. The current pathname only affects the caller's push/replace
  // decision; destination construction is deliberately state-based.
  void pathname
  return { routerPath, href: localizePath(routerPath, locale) }
}
