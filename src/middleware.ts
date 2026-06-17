import { createServerClient } from "@supabase/ssr";
import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from "next/server";
import { routing } from '@/i18n/routing'
import { resolveAdminModeCookie } from '@/lib/auth/admin-mode-cookie'
import { verifyChallengeToken, CHALLENGE_COOKIE_NAME } from '@/lib/security/challenge'
import { checkRateLimit, checkSoftRateLimit, getClientIp } from "@/lib/security/rate-limiter";

/**
 * Routes that are reserved for static pages and cannot be used as brand slugs.
 * Used by the brands service to validate slug uniqueness against app routes.
 */
export const RESERVED_ROUTES = new Set([
  'admin',
  'api',
  '_next',
  'auth',
  'challenge',
  'submit',
  'categories',
  'category',
  'brands',
  'site',
  'dashboard',
  'faq',
  'about',
  'terms',
  'my-submissions',
  'settings',
  'global-error',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  // Next.js metadata routes — single-segment paths that must not be treated as brand slugs
  'icon',
  'apple-icon',
  'opengraph-image',
])

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/
const intlMiddleware = createMiddleware(routing)
const KNOWN_LOCALES = new Set<string>(routing.locales)
const PUBLIC_INTL_SEGMENTS = new Set([
  'brands',
  'categories',
  'about',
  'faq',
  'terms',
  'submit',
  'my-submissions',
  'dashboard',
  'settings',
])
const SOFT_LIMIT_PREFIXES = ['/brands/', '/categories/']

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

  const currentCookie = request.cookies.get('fm_mode')?.value
  const decision = resolveAdminModeCookie({ email: user?.email ?? null, currentCookie })
  if (decision.action === 'set') {
    response.cookies.set('fm_mode', decision.value, {
      sameSite: 'lax',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  } else if (decision.action === 'delete') {
    response.cookies.delete('fm_mode')
  }

  return supabaseResponse;
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  if (host === (process.env.MICROSITE_HOST ?? 'brand.formoria.com')) {
    const { pathname } = request.nextUrl
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

  const { pathname } = request.nextUrl

  const cfOriginSecret = process.env.CF_ORIGIN_SECRET
  if (process.env.NODE_ENV === 'production' && cfOriginSecret) {
    const cfSecret = request.headers.get('x-origin-verify')
    if (cfSecret !== cfOriginSecret && request.nextUrl.pathname !== '/api/health') {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Check rate limit before regular request processing
  const rateLimitResponse = await checkRateLimit(request)
  if (rateLimitResponse) return rateLimitResponse

  if (isSoftLimitPath(pathname)) {
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

  // Redirect top-level brand slugs: /:slug → /brands/:slug (301 for SEO continuity)
  // Only applies to single-segment paths that match the brand slug format
  // and are not reserved app routes or locale prefixes.
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 1) {
    const slug = segments[0]
    if (!KNOWN_LOCALES.has(slug) && !RESERVED_ROUTES.has(slug) && SLUG_PATTERN.test(slug)) {
      const url = request.nextUrl.clone()
      url.pathname = `/brands/${slug}`
      return NextResponse.redirect(url, 301)
    }
  }

  const response = isLocalizedPublicPath(pathname)
    ? intlMiddleware(request)
    : NextResponse.next({ request })

  return refreshSupabaseSession(request, response)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth/callback (handles its own session exchange)
     * - Files with extensions (e.g. .png, .svg, .jpg)
     */
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
