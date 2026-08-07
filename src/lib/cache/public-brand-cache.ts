import { revalidatePath, revalidateTag } from 'next/cache'
import { routing } from '@/i18n/routing'
import { PRODUCT_SUBCATEGORIES, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export const PUBLIC_BRAND_DATA_TAG = 'public-brand-data'

type PublicBrandCacheInput = {
  slug: string
  previousSlug?: string
}

type PublicEventCacheInput = {
  /**
   * Omitted when only the hub is known to be stale — an event write that names
   * no slug still changes what `/events` lists.
   */
  slug?: string
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
  for (const category of PRODUCT_TYPE_CATEGORIES) {
    revalidateLocalizedPath(`/categories/${category.slug}`)
  }
  for (const subcategory of PRODUCT_SUBCATEGORIES) {
    revalidateLocalizedPath(`/categories/${subcategory.category}/${subcategory.slug}`)
  }
  // /stats and /about render a global approved-brand count, so any approve/hide/delete
  // makes their ISR entries stale even though no brand page changed.
  revalidateLocalizedPath('/stats')
  revalidateLocalizedPath('/about')
  // The sitemap is a single unlocalized route, so its cache key is literal.
  revalidatePath('/sitemap.xml')
}

/**
 * The event counterpart of `revalidatePublicBrand`, and the only place event
 * revalidation paths are built — the API route that receives an event write
 * calls this instead of assembling paths itself.
 *
 * The hub is always included: it lists every event, so any event write makes it
 * stale even when no single detail page changed. The sitemap is included for
 * the same reason it is on the brand path — `sitemap.ts` emits `/events/<slug>`
 * URLs, so without this a freshly seeded event stays missing from the served
 * sitemap.xml for the full revalidate window.
 */
export function revalidatePublicEvent({
  slug,
}: PublicEventCacheInput = {}): void {
  revalidateLocalizedPath('/events')
  if (slug) {
    revalidateLocalizedPath(`/events/${slug}`)
  }
  revalidatePath('/sitemap.xml')
}
