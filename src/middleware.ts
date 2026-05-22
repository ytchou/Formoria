import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limiter";

/**
 * Routes that are reserved for static pages and cannot be used as brand slugs.
 * Used by the brands service to validate slug uniqueness against app routes.
 */
export const RESERVED_ROUTES = new Set([
  'admin',
  'api',
  'auth',
  'submit',
  'categories',
  'dashboard',
  'sentry-example-page',
  'global-error',
])

export async function middleware(request: NextRequest) {
  // Check rate limit before any other processing
  const rateLimitResponse = checkRateLimit(request)
  if (rateLimitResponse) return rateLimitResponse

  let supabaseResponse = NextResponse.next({
    request,
  });

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
          supabaseResponse = NextResponse.next({
            request,
          });
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
