/**
 * The one place a route path is spelled.
 *
 * Every literal href in the app used to be typed out where it was needed, so a
 * route rename meant finding several hundred string literals and trusting that
 * grep saw all of them. This module makes the route table a value: rename a
 * segment here and every caller moves with it, and TypeScript names the call
 * sites that still need a parameter.
 *
 * TWO CONTRACTS, both load-bearing:
 *
 * 1. **No locale prefix, ever.** `@/i18n/navigation`'s `Link` (and
 *    `localizePath` on the raw-string paths) owns prefixing. A builder that
 *    emitted `/zh-TW/brands` would double-prefix the moment it was handed to
 *    the router, producing `/zh-TW/zh-TW/brands` — a 404 that renders fine in
 *    isolation and only breaks in the composed page. Everything here is
 *    prefix-free, exactly like the paths these functions replaced.
 *
 * 2. **Parameters are encoded exactly once.** Pass RAW values — a slug, a city,
 *    an id — never something you already ran through `encodeURIComponent`.
 *    Pre-encoding gives you `%252F` where you wanted `%2F`, which resolves to a
 *    slug containing a literal `%2F` and 404s. Several call sites used to encode
 *    by hand; those manual calls were removed when they moved onto this module.
 *
 * Query strings go through `URLSearchParams`, so a `null`/`undefined` value
 * drops its key rather than serialising the word "null" into the URL.
 */

type QueryValue = string | number | boolean | null | undefined

export type RouteQuery = Record<string, QueryValue>

/** Percent-encodes one path segment. See contract 2 above. */
function seg(value: string): string {
  return encodeURIComponent(value)
}

/** Appends `?a=b` for the keys that actually carry a value, and nothing otherwise. */
function withQuery(path: string, query?: RouteQuery): string {
  if (!query) return path

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }

  const serialized = params.toString()
  return serialized ? `${path}?${serialized}` : path
}

export const routes = {
  home: () => '/',

  // Directory
  brands: (query?: RouteQuery) => withQuery('/brands', query),
  brand: (slug: string, query?: RouteQuery) => withQuery(`/brands/${seg(slug)}`, query),

  // Taxonomy
  categories: () => '/categories',
  category: (categorySlug: string) => `/categories/${seg(categorySlug)}`,
  subcategory: (categorySlug: string, subcategorySlug: string) =>
    `/categories/${seg(categorySlug)}/${seg(subcategorySlug)}`,
  /**
   * The optional-subcategory case, which the canonical, breadcrumb and sitemap
   * builders all had to write out by hand as a nested template.
   */
  categoryPath: (categorySlug: string, subcategorySlug?: string | null) =>
    subcategorySlug
      ? `/categories/${seg(categorySlug)}/${seg(subcategorySlug)}`
      : `/categories/${seg(categorySlug)}`,

  // Editorial
  discover: () => '/discover',
  trail: (slug: string) => `/discover/${seg(slug)}`,
  stories: () => '/stories',
  story: (slug: string) => `/stories/${seg(slug)}`,

  // Retail
  whereToBuy: () => '/where-to-buy',
  whereToBuyCity: (citySlug: string) => `/where-to-buy/${seg(citySlug)}`,

  // Static
  about: () => '/about',
  faq: () => '/faq',
  contact: () => '/contact',
  privacy: () => '/privacy',
  terms: () => '/terms',
  challenge: () => '/challenge',
  contributions: () => '/contributions',

  // Signed-in account surfaces
  favorites: () => '/favorites',
  settings: () => '/settings',

  submit: {
    index: () => '/submit',
    recommend: (query?: RouteQuery) => withQuery('/submit/recommend', query),
    confirmation: (query?: RouteQuery) => withQuery('/submit/confirmation', query),
  },

  auth: {
    /** The auth section itself — a prefix, used by the analytics and staging gates. */
    index: () => '/auth',
    signIn: (query?: RouteQuery) => withQuery('/auth/sign-in', query),
    signUp: (query?: RouteQuery) => withQuery('/auth/sign-up', query),
    forgotPassword: () => '/auth/forgot-password',
    resetPassword: (query?: RouteQuery) => withQuery('/auth/reset-password', query),
    signOut: () => '/auth/sign-out',
    callback: (query?: RouteQuery) => withQuery('/auth/callback', query),
  },

  admin: {
    index: () => '/admin',
    brands: (query?: RouteQuery) => withQuery('/admin/brands', query),
    corrections: () => '/admin/corrections',
    curatedProducts: (query?: RouteQuery) => withQuery('/admin/curated-products', query),
    evidence: () => '/admin/evidence',
    jobs: (query?: RouteQuery) => withQuery('/admin/jobs', query),
    job: (id: string) => `/admin/jobs/${seg(id)}`,
    /** The job's rendered run log, served by a route handler under `/admin`. */
    jobRunlog: (id: string) => `/admin/jobs/${seg(id)}/runlog`,
    moderation: () => '/admin/moderation',
    newsletter: () => '/admin/newsletter',
    newsletterExport: (query?: RouteQuery) =>
      withQuery('/admin/newsletter/export', query),
    /**
     * The server-action namespace the rate limiter buckets by:
     * `RATE_LIMIT_RULES` in `lib/security/rate-limiter.ts` uses this builder as
     * its key, so the 3-req/60s bucket moves with a rename here instead of
     * quietly matching nothing.
     */
    operations: () => '/admin/operations',
    /** The vendored Decap CMS build under `public/admin/content`. */
    content: () => '/admin/content',
    quality: () => '/admin/quality',
    reports: () => '/admin/reports',
    scripts: () => '/admin/scripts',
    bulkCommunitySubmissions: () => '/admin/scripts/bulk-community-submissions',
    /** Review queue for reader-submitted stockists; nothing else publishes one. */
    stockists: () => '/admin/stockists',
    submissions: (query?: RouteQuery) => withQuery('/admin/submissions', query),
  },
} as const
