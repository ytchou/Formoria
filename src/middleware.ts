import { createServerClient } from "@supabase/ssr";
import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from "next/server";
import { routing } from '@/i18n/routing'
import { checkRateLimit } from "@/lib/security/rate-limiter";

/**
 * Routes that are reserved for static pages and cannot be used as brand slugs.
 * Used by the brands service to validate slug uniqueness against app routes.
 */
export const RESERVED_ROUTES = new Set([
  'admin',
  'api',
  '_next',
  'auth',
  'submit',
  'categories',
  'category',
  'brands',
  'dashboard',
  'faq',
  'about',
  'terms',
  'support',
  'my-submissions',
  'sentry-example-page',
  'global-error',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  // Next.js metadata routes — single-segment paths that must not be treated as brand slugs
  'icon',
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
  'support',
])

function isLocalizedPublicPath(pathname: string) {
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
  // to properly validate the JWT against the Supabase Auth server
  await supabase.auth.getUser();

  return supabaseResponse;
}

export async function middleware(request: NextRequest) {
  // Check rate limit before any other processing
  const rateLimitResponse = checkRateLimit(request)
  if (rateLimitResponse) return rateLimitResponse

  // Redirect top-level brand slugs: /:slug → /brands/:slug (301 for SEO continuity)
  // Only applies to single-segment paths that match the brand slug format
  // and are not reserved app routes or locale prefixes.
  const { pathname } = request.nextUrl
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
