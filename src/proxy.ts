import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { routes } from "@/lib/routes";
import {
  isAppLocale,
  localizePath,
  LOCALE_COOKIE,
  resolveInitialLocale,
} from "@/i18n/locale-preference";
import {
  IMPERSONATE_COOKIE,
  resolveImpersonationCookie,
} from "@/lib/auth/impersonation";
import {
  verifyChallengeToken,
  CHALLENGE_COOKIE_NAME,
} from "@/lib/security/challenge";
import {
  checkRateLimit,
  checkSoftRateLimit,
  getClientIp,
  isLikelyCrawler,
  isRateLimitStoreDegraded,
  isRouterRequest,
} from "@/lib/security/rate-limiter";
import { RATE_LIMIT_STORE_HEADER } from "@/lib/security/rate-limit-observability";
import {
  hasApprovedBrandSlug,
  resolveApprovedBrandRedirect,
} from "@/lib/services/brand-redirects-edge";
import {
  L1_CATEGORIES,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import { recordCrawlerHit } from "@/lib/security/crawler-telemetry";
import {
  isAllowedStagingRequest,
  isStagingRequest,
} from "@/lib/deployment-environment";

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
  "categories",
  "contact",
  "stories",
  "discover",
  "events",
  "where-to-buy",
  "site",
  "dashboard",
  "favorites",
  "feature-requests",
  "faq",
  "about",
  "vision",
  "terms",
  "my-submissions",
  "contributions",
  "settings",
  "getting-started",
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

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

/**
 * Paths that bypass the Cloudflare origin guard below. Machine callers reach
 * these straight at the Railway origin with no edge credential.
 *
 * The match mode per entry is load-bearing: `/api/internal/revalidate-brands` is
 * EXACT, because a prefix match there would exempt the whole of
 * `/api/internal/`, which is deliberately guarded.
 */
export const ORIGIN_GUARD_EXEMPT_PATHS = [
  // Railway probes this from inside its own private network, with no edge
  // header. A 403 here fails every deploy's health check forever — including
  // the deploy that would fix it.
  { pathname: "/api/health", match: "prefix" },
  { pathname: "/api/cron/", match: "prefix" },
  { pathname: "/api/internal/revalidate-brands", match: "exact" },
] as const satisfies ReadonlyArray<{
  pathname: string;
  match: "prefix" | "exact";
}>;

export function isOriginGuardExempt(pathname: string): boolean {
  return ORIGIN_GUARD_EXEMPT_PATHS.some((entry) =>
    entry.match === "prefix"
      ? pathname.startsWith(entry.pathname)
      : pathname === entry.pathname,
  );
}

export type BareBrandSlugDecision =
  | { action: "redirect"; status: 301; pathname: string }
  | { action: "not-found"; status: 404 };

export function decideBareBrandSlug(
  slug: string,
  isApproved: boolean,
): BareBrandSlugDecision {
  return isApproved
    ? { action: "redirect", status: 301, pathname: routes.brand(slug) }
    : { action: "not-found", status: 404 };
}

const intlMiddleware = createMiddleware(routing);
const KNOWN_LOCALES = new Set<string>(routing.locales);
const ADMIN_DEFAULT_LOCALE = "en";
const NEXT_INTL_LOCALE_HEADER = "X-NEXT-INTL-LOCALE";
const NON_LOCALIZED_AUTH_ROUTES = new Set([
  routes.auth.callback(),
  routes.auth.signOut(),
]);
/**
 * First path segments that carry a locale. Drives locale inference for
 * prefix-free (zh-TW) URLs. Every `src/app/[locale]` route with a `page.tsx`
 * belongs here — `route-registration.test.ts` enforces it.
 */
export const PUBLIC_INTL_SEGMENTS = new Set([
  "auth",
  "brands",
  "categories",
  "stories",
  "discover",
  "events",
  "where-to-buy",
  "about",
  "vision",
  "contact",
  "faq",
  "getting-started",
  "terms",
  "submit",
  "challenge",
  "my-submissions",
  "contributions",
  "dashboard",
  "settings",
  "favorites",
  "feature-requests",
  "privacy",
]);
const SOFT_LIMIT_PREFIXES = ["/brands/"];
const DIRECTORY_EDGE_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";
const DIRECTORY_INDEX_PATHS = new Set([
  routes.brands(),
  ...routing.locales.map((locale) => `/${locale}${routes.brands()}`),
]);

function parseDirectoryPath(pathname: string): {
  locale: string;
  path: string;
} {
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) return { locale, path: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, path: pathname.slice(locale.length + 1) || "/" };
    }
  }
  return { locale: "zh-TW", path: pathname };
}

export function isDirectoryIndexPath(pathname: string, search = ""): boolean {
  if (search) return false;
  if (DIRECTORY_INDEX_PATHS.has(pathname)) return true;

  const { path } = parseDirectoryPath(pathname);
  const segments = path.split("/").filter(Boolean);
  if (
    segments[0] !== "categories" ||
    (segments.length !== 2 && segments.length !== 3)
  ) {
    return false;
  }
  const category = L1_CATEGORIES.find(
    (item) => item.slug === segments[1],
  );
  if (!category) return false;
  if (segments.length === 2) return true;
  return subcategoryBySlug(segments[2] ?? "")?.category === category.slug;
}

export type DirectoryTaxonomyRedirect =
  { action: "redirect"; status: 301; pathname: string } | { action: "none" };

function singleQueryValue(
  searchParams: URLSearchParams,
  key: string,
): string | null | undefined {
  const values = searchParams.getAll(key);
  if (values.length !== 1) return undefined;
  const parts =
    values[0]
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return parts.length === 1 ? (parts[0] ?? null) : undefined;
}

export function decideDirectoryTaxonomyRedirect(
  pathname: string,
  searchParams: URLSearchParams | string,
): DirectoryTaxonomyRedirect {
  const params =
    typeof searchParams === "string"
      ? new URLSearchParams(searchParams)
      : searchParams;
  const { locale, path } = parseDirectoryPath(pathname);
  if (path !== routes.brands()) return { action: "none" };

  for (const facet of ["search", "price", "verification", "sort"]) {
    if (params.get(facet)?.trim()) return { action: "none" };
  }

  const categorySlug = singleQueryValue(params, "category");
  if (
    !categorySlug ||
    !L1_CATEGORIES.some((category) => category.slug === categorySlug)
  ) {
    return { action: "none" };
  }

  const subValues = params.getAll("sub");
  let subcategorySlug: string | null = null;
  if (subValues.length > 1) return { action: "none" };
  if (subValues.length === 1) {
    const parts =
      subValues[0]
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    if (parts.length > 1) return { action: "none" };
    const candidate = parts[0];
    if (candidate && subcategoryBySlug(candidate)?.category === categorySlug) {
      subcategorySlug = candidate;
    }
  }

  const destinationPath = routes.categoryPath(categorySlug, subcategorySlug);
  const destination = new URLSearchParams(params.toString());
  destination.delete("category");
  destination.delete("sub");
  const query = destination.toString();
  const localizedPath = localizePath(destinationPath, locale);
  return {
    action: "redirect",
    status: 301,
    pathname: query ? `${localizedPath}?${query}` : localizedPath,
  };
}

function isSoftLimitPath(pathname: string) {
  let normalizedPathname = pathname;
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) {
      normalizedPathname = "/";
      break;
    }
    if (pathname.startsWith(`/${locale}/`)) {
      normalizedPathname = pathname.slice(locale.length + 1);
      break;
    }
  }

  return SOFT_LIMIT_PREFIXES.some((prefix) =>
    normalizedPathname.startsWith(prefix),
  );
}

export function isLocalizedPublicPath(pathname: string) {
  if (NON_LOCALIZED_AUTH_ROUTES.has(pathname)) return false;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;

  const [firstSegment, secondSegment] = segments;
  if (KNOWN_LOCALES.has(firstSegment)) {
    return segments.length === 1 || PUBLIC_INTL_SEGMENTS.has(secondSegment);
  }

  return PUBLIC_INTL_SEGMENTS.has(firstSegment);
}

function normalizePathname(pathname: string): string {
  const segments = pathname.split("/");
  const canonicalLocale = routing.locales.find(
    (locale) => locale.toLowerCase() === segments[1]?.toLowerCase(),
  );

  return segments
    .map((segment, index) =>
      index === 1 && canonicalLocale
        ? canonicalLocale
        : segment
            .split(/(%[0-9A-Fa-f]{2})/)
            .map((part, partIndex) =>
              partIndex % 2 === 0 ? part.toLowerCase() : part,
            )
            .join(""),
    )
    .join("/");
}

function getBrandDetailSlug(segments: string[]): string | null {
  if (segments.length === 2 && segments[0] === "brands")
    return segments[1] ?? null;
  if (
    segments.length === 3 &&
    KNOWN_LOCALES.has(segments[0] ?? "") &&
    segments[1] === "brands"
  ) {
    return segments[2] ?? null;
  }
  return null;
}

/** One-shot latch so the missing-credentials error is not logged per request. */
let supabaseCredentialsWarningEmitted = false;

async function hasAuthenticatedUser(request: NextRequest): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return false;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  });
  try {
    const { data } = await supabase.auth.getUser();
    return data.user !== null;
  } catch {
    return false;
  }
}

async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse,
) {
  const supabaseResponse = response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No credentials configured means there is no session to refresh. Production
  // always has both, so this only short-circuits environments that run without
  // Supabase (unit tests, credential-less previews); the outcome — an
  // unauthenticated request carrying the untouched response — is the same one
  // the `getUser()` catch below already produces.
  //
  // In production this silently logs out every user with no other symptom, so
  // announce it loudly — once per process, since it would otherwise fire on
  // every request. It stays non-throwing: a crash here takes down anonymous
  // traffic too. `console.error` rather than the Sentry adapter because this
  // runs in the edge runtime, where the Node SDK cannot be imported.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!supabaseCredentialsWarningEmitted) {
      supabaseCredentialsWarningEmitted = true;
      console.error(
        "[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing — session refresh is disabled and every request will be treated as unauthenticated.",
      );
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

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

  const impersonateCookie = request.cookies.get(IMPERSONATE_COOKIE)?.value;
  const impersonateDecision = await resolveImpersonationCookie({
    email: user?.email ?? null,
    currentCookie: impersonateCookie,
  });
  if (impersonateDecision.action === "delete") {
    response.cookies.delete(IMPERSONATE_COOKIE);
  }

  return supabaseResponse;
}

function finalizeResponse(
  response: NextResponse,
  staging: boolean,
): NextResponse {
  if (staging) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
    const revision = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
    if (revision) response.headers.set("X-Formoria-Revision", revision);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const staging = isStagingRequest(request.headers.get("host"));
  const isPlaywrightTest = process.env.PLAYWRIGHT_TEST === "true";
  const routerRequest = isRouterRequest(request);

  if (staging && pathname === "/sitemap.xml") {
    return finalizeResponse(
      new NextResponse("Not found", { status: 404 }),
      staging,
    );
  }

  // The mutation lockdown exists to protect the DEPLOYED staging environment.
  // A local `next dev` server that merely points `.env.local` at staging is not
  // that — but `isStagingRequest` only reads env vars and the staging hostname,
  // so it cannot tell the two apart. Without this gate, aiming local dev at
  // staging 403s every unauthenticated POST on localhost, which silently kills
  // dev tooling (the Next.js devtools annotation panel among it) with an error
  // that reads like a deployment problem.
  //
  // The exemption keys on DEPLOYMENT, not on build mode. RAILWAY_GIT_COMMIT_SHA
  // is injected by the container that serves deployed staging and is absent on
  // a laptop, so a deployed container stays locked down even if something sets
  // NODE_ENV=development (a debug build, a container misconfiguration).
  // NODE_ENV alone would be a convention, not a constraint, and getting it
  // wrong opens every unauthenticated mutation on deployed staging.
  //
  // NODE_ENV still narrows the local case to `next dev`, which is the only
  // runner that sets `development`: the lockdown therefore stays armed under
  // `test` (where middleware-staging.test.ts asserts it) and under
  // `production`.
  //
  // Deliberately narrower than relaxing `isStagingEnvironment()`, which must
  // stay true here — lib/email/send.ts keys outbound email suppression off it,
  // and flipping it would make a laptop pointed at staging send real mail.
  const isDeployedRuntime = Boolean(process.env.RAILWAY_GIT_COMMIT_SHA?.trim());
  const enforceStagingLockdown =
    staging && (isDeployedRuntime || process.env.NODE_ENV !== "development");
  const initiallyAllowed = isAllowedStagingRequest(request.method, pathname);
  const mayAuthenticateMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );
  const authenticated =
    enforceStagingLockdown && !initiallyAllowed && mayAuthenticateMutation
      ? await hasAuthenticatedUser(request)
      : false;
  const stagingRequestAllowed =
    !enforceStagingLockdown ||
    initiallyAllowed ||
    isAllowedStagingRequest(request.method, pathname, authenticated);

  if (!stagingRequestAllowed) {
    return finalizeResponse(
      NextResponse.json(
        { error: "This flow is disabled in staging" },
        { status: 403 },
      ),
      staging,
    );
  }

  // `isLikelyCrawler` is one precompiled union regex; `recordCrawlerHit` re-scans
  // the registry entry by entry. Gating on it keeps the human-traffic common
  // case at a single test.
  const crawlerHit = !isPlaywrightTest && isLikelyCrawler(request);

  const host = request.headers.get("host") ?? "";
  if (host === (process.env.MICROSITE_HOST ?? "brand.formoria.com")) {
    const segments = pathname.split("/").filter(Boolean);

    // Microsite traffic is recorded under the post-rewrite path so it lands in
    // the `microsite` path_class instead of being silently absent from the
    // telemetry. Recorded before the branch returns because both exits below
    // are terminal.
    if (crawlerHit) {
      recordCrawlerHit({
        headers: request.headers,
        nextUrl: { pathname: `/site${pathname}` },
      });
    }

    if (segments.length === 1) {
      const slug = segments[0];
      if (
        !RESERVED_ROUTES.has(slug) &&
        slug !== "_next" &&
        slug !== "api" &&
        SLUG_PATTERN.test(slug)
      ) {
        const url = request.nextUrl.clone();
        url.pathname = `/site${pathname}`;
        return finalizeResponse(NextResponse.rewrite(url), staging);
      }
    }

    return finalizeResponse(NextResponse.next(), staging);
  }

  const cfOriginSecret = process.env.CF_ORIGIN_SECRET;
  if (process.env.NODE_ENV === "production" && cfOriginSecret) {
    // Two different credentials, one header each:
    //   x-formoria-edge → CF_ORIGIN_SECRET, asserted by Cloudflare. A PATH
    //     assertion: "this request came through our edge." That is what this
    //     guard checks.
    //   x-origin-verify → ORIGIN_SECRET, asserted by a machine caller. A CALLER
    //     assertion, verified inside the handler, not here.
    // They used to share x-origin-verify, and a zone-wide Cloudflare transform
    // rule overwrote it on every request — clobbering the caller credential and
    // silently breaking every pg_cron job.
    //
    // TEMPORARY: x-origin-verify is still accepted as a fallback because the
    // Cloudflare rule that injects x-formoria-edge does not exist yet. Remove
    // the fallback once that rule has soaked. When the new header IS present it
    // decides on its own — falling back after a wrong new header would let the
    // legacy header override it and defeat the migration.
    //
    // Exempt paths are called machine-to-machine straight at the Railway origin
    // (the public host is Cloudflare-fronted and bot-challenges those POSTs), so
    // they carry no edge credential and authenticate themselves inside their own
    // handler. /api/internal/revalidate-brands follows the same contract as
    // /api/cron/; the rest of /api/internal/ keeps this guard as a second layer
    // and is deliberately not exempt.
    const edgeHeader = request.headers.get("x-formoria-edge");
    const edgeSecret = edgeHeader ?? request.headers.get("x-origin-verify");
    if (
      edgeSecret !== cfOriginSecret &&
      !isOriginGuardExempt(request.nextUrl.pathname)
    ) {
      return finalizeResponse(
        new NextResponse("Forbidden", { status: 403 }),
        staging,
      );
    }
  }

  if (pathname === routes.auth.callback()) {
    return finalizeResponse(NextResponse.next(), staging);
  }

  if (pathname.startsWith(routes.admin.content())) {
    return finalizeResponse(NextResponse.next(), staging);
  }

  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = normalizedPathname;
    return finalizeResponse(NextResponse.redirect(url, 301), staging);
  }

  const taxonomyRedirect = decideDirectoryTaxonomyRedirect(
    pathname,
    request.nextUrl.searchParams,
  );
  if (taxonomyRedirect.action === "redirect") {
    const url = request.nextUrl.clone();
    const destination = new URL(taxonomyRedirect.pathname, request.url);
    url.pathname = destination.pathname;
    url.search = destination.search;
    return finalizeResponse(
      NextResponse.redirect(url, taxonomyRedirect.status),
      staging,
    );
  }

  // Below BOTH 301s — the pathname normalization above and the taxonomy
  // redirect. A crawler that requests a non-canonical path would otherwise be
  // counted once for the redirect and again when it follows it.
  if (crawlerHit) {
    recordCrawlerHit(request);
  }

  // Check rate limit before regular request processing
  if (!isPlaywrightTest) {
    const rateLimitResponse = await checkRateLimit(request);
    if (rateLimitResponse) return finalizeResponse(rateLimitResponse, staging);
  }

  if (!isPlaywrightTest && !routerRequest && isSoftLimitPath(pathname)) {
    const challengeCookie = request.cookies.get(CHALLENGE_COOKIE_NAME)?.value;
    let isVerified = false;
    if (challengeCookie) {
      try {
        isVerified = await verifyChallengeToken(
          challengeCookie,
          getClientIp(request),
        );
      } catch {
        isVerified = false;
      }
    }

    if (!isVerified) {
      const shouldChallenge = await checkSoftRateLimit(request);
      if (shouldChallenge) {
        const url = request.nextUrl.clone();
        url.pathname = routes.challenge();
        url.searchParams.set("returnTo", pathname + request.nextUrl.search);
        return finalizeResponse(NextResponse.redirect(url), staging);
      }
    }
  }

  const segments = pathname.split("/").filter(Boolean);
  const brandSlug = getBrandDetailSlug(segments);
  if (brandSlug) {
    let decodedSlug: string;
    try {
      decodedSlug = decodeURIComponent(brandSlug);
    } catch {
      return finalizeResponse(new NextResponse(null, { status: 404 }), staging);
    }

    const redirectSlug = await resolveApprovedBrandRedirect(decodedSlug);
    if (redirectSlug) {
      const url = request.nextUrl.clone();
      const locale = isAppLocale(segments[0]) ? segments[0] : "zh-TW";
      url.pathname = localizePath(routes.brand(redirectSlug), locale);
      return finalizeResponse(NextResponse.redirect(url, 308), staging);
    }
  }

  // Redirect top-level brand slugs: /:slug → /brands/:slug (301 for SEO continuity)
  // Only applies to single-segment paths that match the brand slug format
  // and are not reserved app routes or locale prefixes.
  if (segments.length === 1) {
    const slug = segments[0];
    if (
      !KNOWN_LOCALES.has(slug) &&
      !RESERVED_ROUTES.has(slug) &&
      SLUG_PATTERN.test(slug)
    ) {
      // A failed existence check must retain the old redirect behavior so a
      // transient Supabase outage cannot make a real brand unavailable.
      let isApproved = true;
      try {
        isApproved = await hasApprovedBrandSlug(slug);
      } catch {
        isApproved = true;
      }

      const decision = decideBareBrandSlug(slug, isApproved);
      if (decision.action === "not-found") {
        return finalizeResponse(
          new NextResponse(null, { status: decision.status }),
          staging,
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = decision.pathname;
      return finalizeResponse(
        NextResponse.redirect(url, decision.status),
        staging,
      );
    }
  }

  const isPublicPath = isLocalizedPublicPath(pathname);
  const explicitLocale = isAppLocale(segments.at(0)) ? segments.at(0) : null;
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const shouldInferLocale =
    isPublicPath && !explicitLocale && !isLikelyCrawler(request);
  const inferredLocale = shouldInferLocale
    ? resolveInitialLocale({
        cookieLocale,
        acceptLanguage: request.headers.get("accept-language"),
        country:
          request.headers.get("cf-ipcountry") ??
          request.headers.get("x-vercel-ip-country"),
      })
    : null;

  if (isPublicPath && !explicitLocale && inferredLocale === "en") {
    const url = request.nextUrl.clone();
    url.pathname = localizePath(pathname, "en");
    const localeResponse = NextResponse.redirect(url);
    if (!routerRequest) {
      localeResponse.cookies.set(LOCALE_COOKIE, "en", {
        sameSite: "lax",
        path: "/",
      });
    }
    localeResponse.headers.set("Cache-Control", "private, no-store");
    return finalizeResponse(localeResponse, staging);
  }

  let response: NextResponse;
  const isPrefixlessBrandDetail = brandSlug !== null && explicitLocale === null;
  if (isPrefixlessBrandDetail && inferredLocale !== "en") {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(NEXT_INTL_LOCALE_HEADER, "zh-TW");
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else if (isPublicPath) {
    response = intlMiddleware(request);
  } else {
    const requestHeaders = new Headers(request.headers);
    if (
      pathname === routes.admin.index() ||
      pathname.startsWith(`${routes.admin.index()}/`)
    ) {
      requestHeaders.set(NEXT_INTL_LOCALE_HEADER, ADMIN_DEFAULT_LOCALE);
    }
    // Hand the limiter's breaker state to `/api/health`: middleware and route
    // handlers are separate isolates, so the route cannot read the module-scoped
    // breaker itself. Written on every pass, never conditionally --
    // `new Headers(request.headers)` above copies any client-supplied value, so
    // an unconditional overwrite is what makes the header unspoofable.
    // `/api/health` is not a localized public path, so it always reaches here.
    requestHeaders.set(
      RATE_LIMIT_STORE_HEADER,
      isRateLimitStoreDegraded() ? "degraded" : "ok",
    );
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Only write the cookie when it would actually change. A Set-Cookie header on
  // every HTML response makes the response uncacheable at Cloudflare, so the CDN
  // caches nothing and every request falls through to the origin.
  //
  // URL prefixes control only the current request; only an inferred locale is
  // retained for the browser session. Explicit preferences are persisted by the
  // switcher, auth, and settings flows instead.
  const resolvedLocale = inferredLocale;
  if (resolvedLocale && resolvedLocale !== cookieLocale && !routerRequest) {
    response.cookies.set(LOCALE_COOKIE, resolvedLocale, {
      sameSite: "lax",
      path: "/",
    });
  }

  if (
    isDirectoryIndexPath(pathname, request.nextUrl.search) &&
    !routerRequest &&
    !response.headers.has("set-cookie")
  ) {
    response.headers.set("Cache-Control", DIRECTORY_EDGE_CACHE_CONTROL);
  }

  // Skip Supabase auth refresh for truly public content paths to reduce egress.
  // dashboard, settings, and my-submissions still need auth even though
  // isLocalizedPublicPath returns true for them (they're in PUBLIC_INTL_SEGMENTS).
  if (isPublicPath) {
    const segments = pathname.split("/").filter(Boolean);
    const segment =
      segments.length > 0 && KNOWN_LOCALES.has(segments[0])
        ? segments[1]
        : segments[0];
    // 'auth' is here because the auth pages call redirectIfAuthenticated(), which
    // needs a live Supabase session — skipping the refresh would silently strand
    // already-signed-in users on the sign-in form.
    const AUTH_REQUIRED_SEGMENTS = new Set([
      "auth",
      "dashboard",
      "settings",
      "my-submissions",
      "submit",
      "admin",
      "favorites",
    ]);
    if (!AUTH_REQUIRED_SEGMENTS.has(segment)) {
      return finalizeResponse(response, staging);
    }
  }

  return finalizeResponse(
    await refreshSupabaseSession(request, response),
    staging,
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _next/webpack-hmr (Webpack dev HMR WebSocket endpoint)
     * - favicon.ico (favicon file)
     * - Files with extensions (e.g. .png, .svg, .jpg)
     */
    "/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
