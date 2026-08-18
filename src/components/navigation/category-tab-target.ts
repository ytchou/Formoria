import { localizePath } from '@/i18n/locale-preference'
import { updateDirectoryUrl } from '@/lib/directory-filter-url'
import { L1_CATEGORIES, subcategoryBySlug } from '@/lib/taxonomy/ontology'

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
  const subcategory = categorySlug && activeSubSlug ? subcategoryBySlug(activeSubSlug) : null
  const hasFacet = ['search', 'price', 'verification', 'sort'].some((key) => {
    const value = params.get(key)
    return typeof value === 'string' && value.trim().length > 0
  })
  const multiCategory = validCategories.length > 1
  const subValues = activeSubSlug
    ? activeSubSlug.split(',').map((item) => item.trim()).filter(Boolean)
    : []
  const multiSub = subValues.length > 1
  const validSub = subValues.length === 1 && subcategory?.category === categorySlug
    ? subValues[0] ?? null
    : null
  const pureTaxonomy = Boolean(categorySlug) && !hasFacet && !multiCategory && !multiSub

  let routerPath: string
  if (pureTaxonomy) {
    routerPath = `/categories/${categorySlug}${validSub ? `/${validSub}` : ''}`
  } else if (!categorySlug) {
    routerPath = !clearingAll && hasFacet
      ? updateDirectoryUrl('/brands', params, { category: null, sub: null })
      : '/brands'
  } else {
    const nextCategory = validCategories.join(',')
    routerPath = updateDirectoryUrl('/brands', params, {
      category: nextCategory,
      sub: validSub ?? (multiSub ? subValues.join(',') : null),
    })
  }

  // `pathname` is part of the contract so callers can use this resolver for
  // every surface. The current pathname only affects the caller's push/replace
  // decision; destination construction is deliberately state-based.
  void pathname
  return { routerPath, href: localizePath(routerPath, locale) }
}
