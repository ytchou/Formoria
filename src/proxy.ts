import { createServerClient } from "@supabase/ssr";
import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from "next/server";
import { routing } from '@/i18n/routing'
import { isAppLocale, localizePath, LOCALE_COOKIE, resolveInitialLocale } from '@/i18n/locale-preference'
import { IMPERSONATE_COOKIE, resolveImpersonationCookie } from '@/lib/auth/impersonation'
import { verifyChallengeToken, CHALLENGE_COOKIE_NAME } from '@/lib/security/challenge'
import {
  checkRateLimit,
  checkSoftRateLimit,
  getClientIp,
  isLikelyCrawler,
  isRouterRequest,
} from "@/lib/security/rate-limiter";
import { hasApprovedBrandSlug, resolveApprovedBrandRedirect } from '@/lib/services/brand-redirects'

/**
 * Routes that are reserved for static pages and cannot be used as brand slugs.
 * Used by the brands service to validate slug uniqueness against app routes.
 *
 * A single-segment app route missing from this set is silently 301'd to
 * `/brands/<segment>` and 404s. `route-registration.test.ts` enforces coverage.
 */
export const RESERVED_ROUTES = new Set([
  'admin',
  'api',
  '_next',
  'auth',
  'challenge',
  'submit',
  'brands',
  'contact',
  'stories',
  'events',
  'site',
  'dashboard',
  'favorites',
  'feature-requests',
  'faq',
  'about',
  'vision',
  'terms',
  'my-submissions',
  'contributions',
  'settings',
  'getting-started',
  'glossary',
  'global-error',
  'privacy',
  'stats',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  // Next.js metadata routes — single-segment paths that must not be treated as brand slugs
  'icon',
  'apple-icon',
  'manifest',
  'opengraph-image',
  'twitter-image',
])

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/

export type BareBrandSlugDecision =
  | { action: 'redirect'; status: 301; pathname: string }
  | { action: 'not-found'; status: 404 }

export function decideBareBrandSlug(slug: string, isApproved: boolean): BareBrandSlugDecision {
  return isApproved
    ? { action: 'redirect', status: 301, pathname: `/brands/${slug}` }
    : { action: 'not-found', status: 404 }
}

const intlMiddleware = createMiddleware(routing)
const KNOWN_LOCALES = new Set<string>(routing.locales)
const ADMIN_DEFAULT_LOCALE = 'en'
const NEXT_INTL_LOCALE_HEADER = 'X-NEXT-INTL-LOCALE'
/**
 * First path segments that carry a locale. Drives locale inference for
 * prefix-free (zh-TW) URLs. Every `src/app/[locale]` route with a `page.tsx`
 * belongs here — `route-registration.test.ts` enforces it.
 */
export const PUBLIC_INTL_SEGMENTS = new Set([
  'auth',
  'brands',
  'stories',
  'events',
  'about',
  'vision',
  'contact',
  'faq',
  'getting-started',
  'terms',
  'submit',
  'challenge',
  'my-submissions',
  'contributions',
  'dashboard',
  'settings',
  'favorites',
  'feature-requests',
  'glossary',
  'privacy',
  'stats',
])
const SOFT_LIMIT_PREFIXES = ['/brands/']
const DIRECTORY_EDGE_CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400'
const DIRECTORY_INDEX_PATHS = new Set([
  '/brands',
  ...routing.locales.map((locale) => `/${locale}/brands`),
])

function isDirectoryIndexPath(pathname: string): boolean {
  return DIRECTORY_INDEX_PATHS.has(pathname)
}

function isSoftLimitPath(pathname: string) {
  let normalizedPathname = pathname
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) {
      normalizedPathname = '/'
      break
    }
    if (pathname.startsWith(`/${locale}/`)) {
      normalizedPathname = pathname.slice(locale.length + 1)
      break
    }
  }

  return SOFT_LIMIT_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))
}

export function isLocalizedPublicPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return true

  const [firstSegment, secondSegment] = segments
  if (KNOWN_LOCALES.has(firstSegment)) {
    return segments.length === 1 || PUBLIC_INTL_SEGMENTS.has(secondSegment)
  }

  return PUBLIC_INTL_SEGMENTS.has(firstSegment)
}

function normalizePathname(pathname: string): string {
  const segments = pathname.split('/')
  const canonicalLocale = routing.locales.find(
    (locale) => locale.toLowerCase() === segments[1]?.toLowerCase(),
  )

  return segments
    .map((segment, index) =>
      index === 1 && canonicalLocale
        ? canonicalLocale
        : segment
            .split(/(%[0-9A-Fa-f]{2})/)
            .map((part, partIndex) => (partIndex % 2 === 0 ? part.toLowerCase() : part))
            .join(''),
    )
    .join('/')
}

function getBrandDetailSlug(segments: string[]): string | null {
  if (segments.length === 2 && segments[0] === 'brands') return segments[1] ?? null
  if (
    segments.length === 3 &&
    KNOWN_LOCALES.has(segments[0] ?? '') &&
    segments[1] === 'brands'
  ) {
    return segments[2] ?? null
  }
  return null
}

async function refreshSupabaseSession(request: NextRequest, response: NextResponse) {
  const supabaseResponse = response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — must call getUser() not getSession()
  // to properly validate the JWT against the Supabase Auth server.
  // Timeout prevents stale/invalid tokens from blocking the request.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    // Auth timeout or network error — continue as unauthenticated
  }

  const impersonateCookie = request.cookies.get(IMPERSONATE_COOKIE)?.value
  const impersonateDecision = await resolveImpersonationCookie({
    email: user?.email ?? null,
    currentCookie: impersonateCookie,
  })
  if (impersonateDecision.action === 'delete') {
    response.cookies.delete(IMPERSONATE_COOKIE)
  }

  return supabaseResponse;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPlaywrightTest = process.env.PLAYWRIGHT_TEST === 'true'
  const routerRequest = isRouterRequest(request)

  const host = request.headers.get('host') ?? ''
  if (host === (process.env.MICROSITE_HOST ?? 'brand.formoria.com')) {
    const segments = pathname.split('/').filter(Boolean)

    if (segments.length === 1) {
      const slug = segments[0]
      if (!RESERVED_ROUTES.has(slug) && slug !== '_next' && slug !== 'api' && SLUG_PATTERN.test(slug)) {
        const url = request.nextUrl.clone()
        url.pathname = `/site${pathname}`
        return NextResponse.rewrite(url)
      }
    }

    return NextResponse.next()
  }

  const cfOriginSecret = process.env.CF_ORIGIN_SECRET
  if (process.env.NODE_ENV === 'production' && cfOriginSecret) {
    const cfSecret = request.headers.get('x-origin-verify')
    // Exempt paths are called machine-to-machine straight at the Railway origin
    // (the public host is Cloudflare-fronted and bot-challenges those POSTs), so
    // they carry ORIGIN_SECRET — not CF_ORIGIN_SECRET — in this header and
    // authenticate themselves inside their own handler. /api/internal/revalidate-brands
    // follows the same contract as /api/cron/; the rest of /api/internal/ keeps
    // this guard as a second layer and is deliberately not exempt.
    if (
      cfSecret !== cfOriginSecret &&
      !request.nextUrl.pathname.startsWith('/api/health') &&
      !request.nextUrl.pathname.startsWith('/api/cron/') &&
      request.nextUrl.pathname !== '/api/internal/revalidate-brands'
    ) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  if (pathname.startsWith('/admin/content')) {
    return NextResponse.next()
  }

  const normalizedPathname = normalizePathname(pathname)
  if (normalizedPathname !== pathname) {
    const url = request.nextUrl.clone()
    url.pathname = normalizedPathname
    return NextResponse.redirect(url, 301)
  }

  // Check rate limit before regular request processing
  if (!isPlaywrightTest) {
    const rateLimitResponse = await checkRateLimit(request)
    if (rateLimitResponse) return rateLimitResponse
  }

  if (!isPlaywrightTest && !routerRequest && isSoftLimitPath(pathname)) {
    const challengeCookie = request.cookies.get(CHALLENGE_COOKIE_NAME)?.value
    let isVerified = false
    if (challengeCookie) {
      try {
        isVerified = await verifyChallengeToken(challengeCookie, getClientIp(request))
      } catch {
        isVerified = false
      }
    }

    if (!isVerified) {
      const shouldChallenge = await checkSoftRateLimit(request)
      if (shouldChallenge) {
        const url = request.nextUrl.clone()
        url.pathname = '/challenge'
        url.searchParams.set('returnTo', pathname + request.nextUrl.search)
        return NextResponse.redirect(url)
      }
    }
  }

  const segments = pathname.split('/').filter(Boolean)
  const brandSlug = getBrandDetailSlug(segments)
  if (brandSlug) {
    let decodedSlug: string
    try {
      decodedSlug = decodeURIComponent(brandSlug)
    } catch {
      return new NextResponse(null, { status: 404 })
    }

    const redirectSlug = await resolveApprovedBrandRedirect(decodedSlug)
    if (redirectSlug) {
      const url = request.nextUrl.clone()
      const locale = isAppLocale(segments[0]) ? segments[0] : 'zh-TW'
      url.pathname = localizePath(`/brands/${encodeURIComponent(redirectSlug)}`, locale)
      return NextResponse.redirect(url, 308)
    }
  }

  // Redirect top-level brand slugs: /:slug → /brands/:slug (301 for SEO continuity)
  // Only applies to single-segment paths that match the brand slug format
  // and are not reserved app routes or locale prefixes.
  if (segments.length === 1) {
    const slug = segments[0]
    if (!KNOWN_LOCALES.has(slug) && !RESERVED_ROUTES.has(slug) && SLUG_PATTERN.test(slug)) {
      // A failed existence check must retain the old redirect behavior so a
      // transient Supabase outage cannot make a real brand unavailable.
      let isApproved = true
      try {
        isApproved = await hasApprovedBrandSlug(slug)
      } catch {
        isApproved = true
      }

      const decision = decideBareBrandSlug(slug, isApproved)
      if (decision.action === 'not-found') {
        return new NextResponse(null, { status: decision.status })
      }

      const url = request.nextUrl.clone()
      url.pathname = decision.pathname
      return NextResponse.redirect(url, decision.status)
    }
  }

  const isPublicPath = isLocalizedPublicPath(pathname)
  const explicitLocale = isAppLocale(segments.at(0)) ? segments.at(0) : null
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  const shouldInferLocale = isPublicPath && !explicitLocale && !isLikelyCrawler(request)
  const inferredLocale = shouldInferLocale
    ? resolveInitialLocale({
        cookieLocale,
        acceptLanguage: request.headers.get('accept-language'),
        country: request.headers.get('cf-ipcountry') ?? request.headers.get('x-vercel-ip-country'),
      })
    : null

  if (isPublicPath && !explicitLocale && inferredLocale === 'en') {
    const url = request.nextUrl.clone()
    url.pathname = localizePath(pathname, 'en')
    const localeResponse = NextResponse.redirect(url)
    if (!routerRequest) {
      localeResponse.cookies.set(LOCALE_COOKIE, 'en', {
        sameSite: 'lax',
        path: '/',
      })
    }
    localeResponse.headers.set('Cache-Control', 'private, no-store')
    return localeResponse
  }

  let response: NextResponse
  if (isPublicPath) {
    response = intlMiddleware(request)
  } else {
    const requestHeaders = new Headers(request.headers)
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      requestHeaders.set(NEXT_INTL_LOCALE_HEADER, ADMIN_DEFAULT_LOCALE)
    }
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Only write the cookie when it would actually change. A Set-Cookie header on
  // every HTML response makes the response uncacheable at Cloudflare, so the CDN
  // caches nothing and every request falls through to the origin.
  //
  // URL prefixes control only the current request; only an inferred locale is
  // retained for the browser session. Explicit preferences are persisted by the
  // switcher, auth, and settings flows instead.
  const resolvedLocale = inferredLocale
  if (resolvedLocale && resolvedLocale !== cookieLocale && !routerRequest) {
    response.cookies.set(LOCALE_COOKIE, resolvedLocale, {
      sameSite: 'lax',
      path: '/',
    })
  }

  if (
    isDirectoryIndexPath(pathname) &&
    !routerRequest &&
    !response.headers.has('set-cookie')
  ) {
    response.headers.set('Cache-Control', DIRECTORY_EDGE_CACHE_CONTROL)
  }

  // Skip Supabase auth refresh for truly public content paths to reduce egress.
  // dashboard, settings, and my-submissions still need auth even though
  // isLocalizedPublicPath returns true for them (they're in PUBLIC_INTL_SEGMENTS).
  if (isPublicPath) {
    const segments = pathname.split('/').filter(Boolean)
    const segment = segments.length > 0 && KNOWN_LOCALES.has(segments[0])
      ? segments[1]
      : segments[0]
    // 'auth' is here because the auth pages call redirectIfAuthenticated(), which
    // needs a live Supabase session — skipping the refresh would silently strand
    // already-signed-in users on the sign-in form.
    const AUTH_REQUIRED_SEGMENTS = new Set(['auth', 'dashboard', 'settings', 'my-submissions', 'submit', 'admin', 'favorites'])
    if (!AUTH_REQUIRED_SEGMENTS.has(segment)) {
      return response
    }
  }

  return refreshSupabaseSession(request, response)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _next/webpack-hmr (Webpack dev HMR WebSocket endpoint)
     * - favicon.ico (favicon file)
     * - auth/callback (handles its own session exchange)
     * - Files with extensions (e.g. .png, .svg, .jpg)
     */
    "/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
