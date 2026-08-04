import { updateDirectoryUrl } from '@/lib/directory-filter-url'
import { localizePath } from '@/i18n/locale-preference'

export type CategoryTabTargetInput = {
  pathname: string
  searchParams: string
  slug: string
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
  locale,
}: CategoryTabTargetInput): CategoryTabTarget {
  let routerPath: string

  if (pathname === '/brands') {
    // The category nav is the global escape hatch out of a zero-result state,
    // so it clears every refinement rather than carrying a failing filter into
    // the next category. Non-filter params (e.g. sort) are preserved.
    routerPath = updateDirectoryUrl('/brands', searchParams, {
      category: slug || null,
      search: null,
      sub: null,
      price: null,
      verification: null,
    })
  } else {
    routerPath = slug
      ? `/brands?category=${encodeURIComponent(slug)}`
      : '/brands'
  }

  return {
    routerPath,
    href: localizePath(routerPath, locale),
  }
}
