import { revalidatePath, revalidateTag } from 'next/cache'
import { routing } from '@/i18n/routing'

export const PUBLIC_BRAND_DATA_TAG = 'public-brand-data'

type PublicBrandCacheInput = {
  slug: string
  previousSlug?: string
}

/**
 * `localePrefix: 'as-needed'` hides the default locale (`zh-TW`) from the public
 * URL, but the ISR cache key KEEPS the internal prefix: the prerender manifest
 * only ever holds `/zh-TW/brands/<slug>` and `/en/brands/<slug>` — there is no
 * bare `/brands/<slug>` key. Revalidating an unprefixed path therefore matches
 * nothing and leaves every default-locale page serving stale HTML for the full
 * revalidate window. Always emit one path per locale; do not "simplify" this
 * back to a bare path plus an `/en` special case.
 */
export function revalidateLocalizedPath(path: string): void {
  for (const locale of routing.locales) {
    revalidatePath(path === '/' ? `/${locale}` : `/${locale}${path}`)
  }
}

export function revalidatePublicBrand({
  slug,
  previousSlug,
}: PublicBrandCacheInput): void {
  revalidateTag(PUBLIC_BRAND_DATA_TAG, 'max')
  revalidateLocalizedPath(`/brands/${slug}`)
  if (previousSlug && previousSlug !== slug) {
    revalidateLocalizedPath(`/brands/${previousSlug}`)
  }

  revalidateLocalizedPath('/')
  revalidateLocalizedPath('/brands')
  // /stats and /about render a global approved-brand count, so any approve/hide/delete
  // makes their ISR entries stale even though no brand page changed.
  revalidateLocalizedPath('/stats')
  revalidateLocalizedPath('/about')
  // The sitemap is a single unlocalized route, so its cache key is literal.
  revalidatePath('/sitemap.xml')
}
