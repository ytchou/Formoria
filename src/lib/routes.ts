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

  // Editorial
  discover: (query?: RouteQuery) => withQuery('/discover', query),
  style: () => '/style',
  trail: (slug: string) => `/style/${seg(slug)}`,
  stories: () => '/stories',
  story: (slug: string) => `/stories/${seg(slug)}`,

  // Static
  about: () => '/about',
  faq: () => '/faq',
  contact: () => '/contact',
  privacy: () => '/privacy',
  terms: () => '/terms',
  challenge: () => '/challenge',

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

/**
 * Routes that are reserved for static pages and cannot be used as brand slugs.
 * Used by the brands service to validate slug uniqueness against app routes.
 *
 * A single-segment app route missing from this set is silently 301'd to
 * `/brands/<segment>` and 404s. `route-registration.test.ts` enforces coverage.
 */
export const RESERVED_ROUTES = new Set([
  "admin",
  "api",
  "_next",
  "auth",
  "challenge",
  "submit",
  "brands",
  "category",
  "categories",
  "contact",
  "stories",
  "discover",
  "style",
  "events",
  "favorites",
  // Retired routes. None serve a page, but they stay reserved so a bare hit
  // 404s cleanly instead of being redirected into `/brands/<segment>` by
  // `decideBareBrandSlug`, and so no brand can ever claim one of these slugs.
  //
  // `dashboard` (parked by DEV-1570) matters twice over: `hasApprovedBrandSlug`
  // treats a Supabase error as approved, so an unreserved `/dashboard` would
  // answer a transient outage with a 301 PERMANENT redirect into
  // `/brands/dashboard` that browsers cache forever; and `isReservedSlug` reads
  // this same set, so a brand called "Dashboard" could otherwise take the slug
  // and shadow the app route if DEV-1570 is ever reverted.
  "where-to-buy",
  "feature-requests",
  "feedback",
  "getting-started",
  "dashboard",
  "faq",
  "about",
  "vision",
  "terms",
  "contributions",
  "settings",
  "global-error",
  "privacy",
  "sitemap.xml",
  "robots.txt",
  "favicon.ico",
  // Next.js metadata routes — single-segment paths that must not be treated as brand slugs
  "icon",
  "apple-icon",
  "manifest",
  "opengraph-image",
  "twitter-image",
]);
