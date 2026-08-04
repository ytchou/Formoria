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
    const params = new URLSearchParams(searchParams)
    if (slug) {
      params.set('category', slug)
    } else {
      params.delete('category')
    }
    params.delete('page')
    const query = params.toString()
    routerPath = query ? `/brands?${query}` : '/brands'
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
