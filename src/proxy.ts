import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { routes, RESERVED_ROUTES } from "@/lib/routes";
import { safeDecodeSlug } from "@/lib/url";
import { isAppLocale, localizePath } from "@/i18n/locale-preference";
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
  isTraversalAccountingEnabled,
  softLimitBlockedResponse,
} from "@/lib/security/rate-limiter";
import {
  pseudonymizeIdentifier,
  RATE_LIMIT_STORE_HEADER,
  reportVisitorIdentityRotated,
} from "@/lib/security/rate-limit-observability";
import {
  routeFamily,
  shouldMintVisitorIdentity,
} from "@/lib/security/route-family";
import {
  resolveVisitorIdentity,
  VISITOR_COOKIE_NAME,
  VISITOR_COOKIE_OPTIONS,
} from "@/lib/security/visitor-identity";
import { warnIfOriginGuardDisabled } from "@/lib/security/origin-guard";
import {
  isCrawlerTelemetrySuppressed,
  isRateLimitDisabled,
} from "@/lib/security/test-gates";
import {
  hasApprovedBrandSlug,
  resolveApprovedBrandRedirect,
} from "@/lib/services/brand-redirects-edge";
import {
  L1_CATEGORIES,
  isVisibleCategory,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import { BRAND_SORT_CONFIG } from "@/lib/pagination";
import { DIRECTORY_FILTER_QUERY_KEYS } from "@/lib/seo/directory-query-keys";
import { recordCrawlerHit } from "@/lib/security/crawler-telemetry";
import {
  isAllowedStagingRequest,
  isStagingRequest,
} from "@/lib/deployment-environment";
import {
  E2E_STAGING_SESSION_COOKIE,
  verifyStagingSession,
} from "@/lib/security/staging-session";

export { RESERVED_ROUTES } from "@/lib/routes";

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
  // Health agent fires a deliberate error to validate Sentry round-trip;
  // authenticate itself inside the handler via ORIGIN_SECRET, not the edge.
  { pathname: "/api/internal/sentry-canary", match: "exact" },
  // The staging e2e-nightly-agent calls this on the production Railway origin
  // to claim and complete ops-bot dispatches; it cannot carry the edge header.
  // The handler authenticates with `Authorization: Bearer E2E_DISPATCH_SECRET`.
  { pathname: "/api/internal/e2e-dispatch", match: "exact" },
  // The ops routine (a Claude Code cloud session) posts its thread summary and
  // run-timeline events on the Railway origin, because Cloudflare bot-challenges
  // machine POSTs to formoria.com; it cannot carry the edge header. Both handlers
  // authenticate with `Authorization: Bearer OPS_ROUTINE_CALLBACK_TOKEN`.
  { pathname: "/api/internal/ops-summary", match: "exact" },
  { pathname: "/api/internal/run-timeline", match: "exact" },
  // Next's own image optimizer re-enters middleware for `/i/` paths and cannot
  // be made to carry the edge credential. `/_next/image?url=%2Fi%2F...` is
  // excluded from the matcher, so the optimizer runs; for a non-absolute href
  // it calls `fetchInternalImage`, which builds a MOCK request via
  // `createRequestResponseMocks` with an empty header bag and routes it back
  // through middleware. That mock carries no `x-formoria-edge`, so without
  // this entry the guard 403s it, the optimizer
  // reads an empty body and throws ImageError(400) -- every `next/image`
  // proxied image on the site fails, and only in production, because the guard
  // requires NODE_ENV=production. Do not remove: `/i/` stays in the matcher for
  // the rate limiter's sake, which is what makes this exemption necessary.
  { pathname: "/i/", match: "prefix" },
  // Slack cannot carry the edge header; signature verification is the auth
  { pathname: "/api/slack/", match: "prefix" },
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

/**
 * A server-action POST that also claims to be an RSC navigation. The real
 * client never sends this pair -- `server-action-reducer` sets `next-action`
 * and `Accept: text/x-component`, never `RSC` -- so only a forged request
 * matches. Only the literal `"1"` counts, as in Next's `isRSCRequestHeader`.
 */
export function isForgedRscActionRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    request.headers.has("next-action") &&
    request.headers.get("rsc") === "1"
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
/**
 * A path segment no route defines. The proxy's own 404s rewrite to
 * `/<locale>/<this>`, which lands on `[locale]/(site)/[...rest]/page.tsx` and
 * renders the branded not-found page instead of an empty body.
 */
export const NOT_FOUND_REWRITE_SEGMENT = "__proxy-not-found__";
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
  "style",
  "events",
  "about",
  "contact",
  "faq",
  "terms",
  "submit",
  "challenge",
  "contributions",
  "settings",
  "favorites",
  "privacy",
]);
const SOFT_LIMIT_PREFIXES = ["/brands/"];
const DIRECTORY_EDGE_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";
// The bounded directory facets, derived from the canonical vocabulary in
// `@/lib/seo/directory-query-keys` rather than restated here. A filter view is
// a bounded set of renderings the edge can hold; free-text `search` is
// unbounded and would fill the cache with single-use entries, which is why the
// filter list excludes it.
//
// Keys alone do not bound the key space. Every parser coerces junk to a default
// -- `parsePageParam` clamps, `parseSortParam` falls back to `random`, the slug
// facets drop unknown terms -- so `?page=<random>` renders the identical page
// under an unlimited number of distinct edge keys, all of them permanent
// MISSes. `isCacheableQueryValue` below closes that by bounding the VALUES too.
export const CACHEABLE_DIRECTORY_QUERY_KEYS: ReadonlySet<string> = new Set(
  DIRECTORY_FILTER_QUERY_KEYS,
);

/**
 * The highest page number worth an edge cache key.
 *
 * Ceiling: ~718 approved brands at 12 per page is ~60 pages for the
 * unfiltered directory, and every filter view is shorter; 100 leaves room for
 * the catalogue to grow by half. Upgrade path: derive it from the real approved
 * count once an edge-safe source for that count exists, or raise the constant
 * when the directory passes ~1000 brands.
 *
 * A page above the ceiling still RENDERS exactly as it does today -- this
 * decides cacheability only.
 */
const MAX_CACHEABLE_DIRECTORY_PAGE = 100;

const CACHEABLE_SORT_VALUES: ReadonlySet<string> = new Set(
  Object.keys(BRAND_SORT_CONFIG),
);

/** The comma list the directory parsers accept, split the same way they do. */
function splitFacetValue(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isCacheableFacetList(
  raw: string,
  isKnown: (value: string) => boolean,
): boolean {
  const parts = splitFacetValue(raw);
  return parts.length > 0 && parts.every(isKnown);
}

/**
 * Whether one allow-listed query value is inside the closed vocabulary the page
 * actually renders from.
 *
 * A `false` never changes what a visitor sees -- the page renders as before,
 * with the unknown term dropped. It only refuses to spend an edge key on a URL
 * a bot can mint an unbounded number of.
 *
 * The taxonomy checks reuse `L1_CATEGORIES` / `subcategoryBySlug`, which this
 * file already imports for the path half of the predicate.
 * `parseDirectoryViewFilters` stays out of the edge bundle on purpose (see
 * `@/lib/seo/directory-query-keys`), so the two enum vocabularies it holds
 * inline are restated above. Ceiling: they must be changed together; a drift
 * only over-restricts caching, it cannot change a rendering.
 */
function isCacheableQueryValue(key: string, raw: string): boolean {
  switch (key) {
    case "page":
      return (
        /^[1-9][0-9]*$/.test(raw) && Number(raw) <= MAX_CACHEABLE_DIRECTORY_PAGE
      );
    case "sort":
      return CACHEABLE_SORT_VALUES.has(raw);
    case "category":
      return isCacheableFacetList(raw, (value) =>
        L1_CATEGORIES.some((item) => item.slug === value),
      );
    case "sub":
      return isCacheableFacetList(
        raw,
        (value) => subcategoryBySlug(value) !== null,
      );
    default:
      return false;
  }
}
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

/**
 * Whether a /discover query names a category the page would reject. Mirrors
 * the page's `firstParam` read (first value, trimmed) so both agree.
 */
export function hasUnknownDiscoverCategory(
  searchParams: URLSearchParams,
): boolean {
  const category = searchParams.get("category")?.trim();
  return category ? !isVisibleCategory(category) : false;
}

export function isDirectoryIndexPath(pathname: string, search = ""): boolean {
  // Pathname first, deliberately. This runs in middleware for nearly every
  // request, and parsing the query for `/api/...?x=1` or a utm-tagged marketing
  // URL is work thrown away one line later.
  if (!DIRECTORY_INDEX_PATHS.has(pathname)) {
    const { path } = parseDirectoryPath(pathname);
    const segments = path.split("/").filter(Boolean);
    if (
      segments[0] !== "categories" ||
      (segments.length !== 2 && segments.length !== 3)
    ) {
      return false;
    }
    const category = L1_CATEGORIES.find((item) => item.slug === segments[1]);
    if (!category) return false;
    if (
      segments.length === 3 &&
      subcategoryBySlug(segments[2] ?? "")?.category !== category.slug
    ) {
      return false;
    }
  }

  if (search) {
    const params = new URLSearchParams(search);
    for (const key of new Set(params.keys())) {
      if (!CACHEABLE_DIRECTORY_QUERY_KEYS.has(key)) return false;
      const values = params.getAll(key);
      // A repeated key multiplies the key space without changing the render:
      // every parser reads a single string and drops an array outright.
      if (values.length !== 1) return false;
      if (!isCacheableQueryValue(key, values[0] ?? "")) return false;
    }
  }

  return true;
}

// decideDirectoryTaxonomyRedirect and DirectoryTaxonomyRedirect removed:
// `/brands?category=home` is the canonical URL now — no redirect to `/categories/home`.

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

/**
 * First path segments Next.js serves that are neither a locale, a reserved
 * route, nor a localized public segment. `route-registration.test.ts` checks
 * every top-level `src/app` route and `public/` entry against
 * `isOutsideAppRoutes`, so a new one cannot be rewritten to a 404 unnoticed.
 */
export const PASS_THROUGH_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  // The same-origin image proxy, `src/app/i/[...path]`. Too short for
  // SLUG_PATTERN, so RESERVED_ROUTES does not list it.
  "i",
  // Top-level directories of `public/`.
  "data",
  "images",
  // RFC 8615 well-known URIs (security.txt, app links) served from `public/`.
  ".well-known",
  // Sentry's tunnel route, if `tunnelRoute` in next.config.ts is enabled.
  "monitoring",
  // The PostHog reverse-proxy path, if one is configured.
  "ingest",
]);

/**
 * True when the path can only match `[locale]` with an invalid locale. That
 * match calls notFound() in the root layout, where Next renders its unbranded
 * default 404, so the proxy rewrites these to the branded page instead.
 * File-like paths (any segment with a `.`) always pass through to Next.
 */
export function isOutsideAppRoutes(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const [firstSegment] = segments;
  if (firstSegment === undefined) return false;
  if (segments.some((segment) => segment.includes("."))) return false;
  // Malformed percent-encoding passes through: Next decodes the original URL
  // even after a rewrite and would answer 500 (see the slug-decode branch).
  try {
    segments.forEach((segment) => decodeURIComponent(segment));
  } catch {
    return false;
  }

  return (
    !KNOWN_LOCALES.has(firstSegment) &&
    !RESERVED_ROUTES.has(firstSegment) &&
    !PUBLIC_INTL_SEGMENTS.has(firstSegment) &&
    !PASS_THROUGH_ROOT_SEGMENTS.has(firstSegment)
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
  // Recruitment is a static localized route, not a prefixless brand-detail page.
  if (segments.at(-1) === "join") return null;
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

const CAPTURE_THROTTLE_MS = 5 * 60 * 1000;

/** Site key -> last capture timestamp. Best-effort only: edge isolates are
 *  short-lived and numerous, so expect up to one capture per isolate per
 *  window. The fingerprint, not the throttle, keeps the issue list readable. */
const lastCaptureAt = new Map<string, number>();

/**
 * The one site whose errors are NOT collapsed into a single Sentry issue. Every
 * other site catches one known failure, so a fixed fingerprint there is what
 * keeps the issue list readable.
 */
const UNGROUPED_CAPTURE_SITE = "unhandled";

/**
 * Turbopack skips the Sentry SDK's webpack-based middleware auto-wrap, so the
 * proxy reports its own failures. `@sentry/nextjs` is imported lazily on every
 * capture to keep it off the successful request path. Every capture is
 * fire-and-forget, so a failed telemetry chunk cannot surface as an application error.
 *
 * Level rule for any new site: a fail-closed or otherwise user-visible outcome
 * reports at `error`; a path that degrades gracefully (anonymous instead of
 * signed in, unverified instead of verified) reports at `warning`.
 *
 * UNVERIFIED UNTIL A DEPLOY: this helper is only exercised by vitest under Node
 * with `@sentry/nextjs` mocked, so neither the Turbopack-built middleware chunk
 * nor the edge Sentry init for the middleware sandbox is covered. Either could
 * make every capture here a silent no-op. Verify by forcing one failure in a
 * deployed environment and confirming the event arrives in Sentry.
 */
function reportProxyFailure(
  site: string,
  error: unknown,
  level: "error" | "warning",
): void {
  try {
    const previous = lastCaptureAt.get(site);
    if (previous !== undefined && Date.now() - previous < CAPTURE_THROTTLE_MS) {
      return;
    }

    void import("@sentry/nextjs")
      .then(({ captureException }) => {
        captureException(error, {
          level,
          tags: { scope: "proxy", area: site },
          // The `unhandled` site catches errors whose identity is unknown in
          // advance, so it falls through to Sentry's default (stack-based)
          // grouping. A fixed fingerprint there folds every future crash into
          // one already-triaged issue and raises no new-issue alert.
          ...(site === UNGROUPED_CAPTURE_SITE
            ? {}
            : { fingerprint: ["proxy", site] }),
        });
        // Recorded only after a capture was actually attempted, so a failed
        // chunk load or a throwing capture cannot silence this site for a full
        // window with zero events sent. Consequence: two failures at one site
        // in the same tick can both capture, because this lands
        // asynchronously — strictly better than permanent silence.
        lastCaptureAt.set(site, Date.now());
      })
      .catch(() => {
        // A failed telemetry chunk load must not surface as an app error, and
        // leaves the site un-throttled so the next failure retries delivery.
      });
  } catch {
    // Telemetry must never change the outcome of a request.
  }
}

/**
 * One-shot latch so the missing-credentials failure is announced once per
 * process — both the console line and the Sentry capture. It is a persistent
 * every-request condition, so throttling alone would still cost one event per
 * cold isolate per window across the whole fleet.
 */
let supabaseCredentialsWarningEmitted = false;

/** Test seam: forget the capture throttle and the missing-credentials latch. */
export function resetProxyTelemetryForTests(): void {
  lastCaptureAt.clear();
  supabaseCredentialsWarningEmitted = false;
}

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
  } catch (error) {
    // `error`, not `warning`: this answer is fail-CLOSED. Returning false turns
    // a signed-in user's mutation on deployed staging into a 403, so an Auth
    // hiccup here is user-visible and must clear an alerting threshold set at
    // error level.
    reportProxyFailure("auth-check", error, "error");
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
  // traffic too.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!supabaseCredentialsWarningEmitted) {
      supabaseCredentialsWarningEmitted = true;
      console.error(
        "[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing — session refresh is disabled and every request will be treated as unauthenticated.",
      );
      reportProxyFailure(
        "supabase-credentials",
        new Error(
          "[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing — session refresh is disabled",
        ),
        "error",
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
  try {
    await supabase.auth.getUser();
  } catch (error) {
    // Auth timeout or network error — continue as unauthenticated.
    // `warning`, not `error`: degrading to anonymous is the correct outcome
    // here, so nothing breaks for the user.
    reportProxyFailure("session-refresh", error, "warning");
  }

  return supabaseResponse;
}

/**
 * A 404 that the app renders. The proxy does not re-run on a rewrite, so the
 * locale header is set here for next-intl.
 */
function rewriteToLocalizedNotFound(
  request: NextRequest,
  locale: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/${NOT_FOUND_REWRITE_SEGMENT}`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NEXT_INTL_LOCALE_HEADER, locale);
  return NextResponse.rewrite(url, {
    status: 404,
    request: { headers: requestHeaders },
  });
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

// A blank CF_ORIGIN_SECRET leaves the origin guard off (see origin-guard.ts).
// That stays non-blocking on purpose, but it must not stay silent.
warnIfOriginGuardDisabled();

/**
 * Reads the signed `fm_visitor` cookie and mints one when it is absent or fails
 * verification. Deliberately reads `request.cookies` and not `cookies()` from
 * `next/headers`, which is server-only and unusable in the edge proxy.
 *
 * Runs after `runProxy` so every terminal return path picks the cookie up,
 * instead of threading a mint through a dozen `finalizeResponse` call sites.
 *
 * Three skips, all deliberate:
 * - the identity exists only to key traversal accounting, and `observeTraversal`
 *   returns immediately while `TRAVERSAL_COUNTERS` is off (the default), so
 *   minting behind that flag would pay a WebCrypto HMAC verify per request for
 *   an output nothing reads;
 * - `shouldMintVisitorIdentity` decides cacheability FROM THE REQUEST. The
 *   previous guard tested the response's `cache-control` for `public` /
 *   `s-maxage`, which middleware runs too early to ever see: the route handler
 *   sets that header afterwards, so the skip never fired. `/i/` was the
 *   casualty -- N parallel uncookied image requests each minted a different
 *   identity, emitted a rotation event, and returned a `Set-Cookie` that makes
 *   a CDN bypass its cache for a response marked `immutable` for a year;
 * - crawlers do not retain cookies, so minting for them buys no identity and
 *   only makes their responses uncacheable.
 *
 * Ceiling: request-shape cacheability is an approximation of the handler's
 * `cache-control`, so a newly cached public route must be added to
 * `shouldMintVisitorIdentity`. Upgrade path: mint at the Cloudflare edge if
 * identity coverage on first paint ever becomes load-bearing.
 */
async function attachVisitorIdentity(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  if (!isTraversalAccountingEnabled()) return response;
  if (
    !shouldMintVisitorIdentity(
      request.nextUrl.pathname,
      request.nextUrl.searchParams,
    )
  ) {
    return response;
  }
  if (isLikelyCrawler(request)) return response;
  // The ceiling above, closed for the one route that outran it: `runProxy` has
  // just stamped the directory edge cache header on a cookie-less, non-RSC
  // directory view, and `shouldMintVisitorIdentity` still returns true for
  // `directory:list`. A `Set-Cookie` here would either drop the response from
  // the CDN or hand one visitor's signed identity to everyone. Matching the
  // exact header keeps minting intact for `?search=`, cookie-carrying, and all
  // non-directory requests.
  if (response.headers.get("cache-control") === DIRECTORY_EDGE_CACHE_CONTROL) {
    return response;
  }

  try {
    const identity = await resolveVisitorIdentity(
      request.cookies.get(VISITOR_COOKIE_NAME)?.value,
    );
    if (identity.minted) {
      response.cookies.set(
        VISITOR_COOKIE_NAME,
        identity.signedValue,
        VISITOR_COOKIE_OPTIONS,
      );
      // A mint is a rotation from the counters' point of view. One per genuine
      // first visit; a stream of them behind one IP key is deliberate. Keyed on
      // the IP, not the new visitor id: the point is to correlate mints that
      // the visitor tier can never see.
      reportVisitorIdentityRotated({
        identityKey: pseudonymizeIdentifier(getClientIp(request)),
        routeFamily: routeFamily(
          request.nextUrl.pathname,
          request.nextUrl.searchParams,
        ),
        reason: request.cookies.has(VISITOR_COOKIE_NAME)
          ? "cookie_failed_verification"
          : "cookie_absent",
      });
    }
  } catch (error) {
    // `warning`: a missing CHALLENGE_SECRET degrades traversal accounting to
    // the IP aggregate. It must never fail a page request.
    reportProxyFailure("visitor-identity", error, "warning");
  }

  return response;
}

/**
 * Admin impersonation was deleted with the owner dashboard (DEV-1570), and with
 * it the only code that ever cleared this cookie. A browser that used
 * view-as-owner before that deploy keeps a signed value until it self-expires,
 * and a `git revert` of DEV-1570 would restore code that honors a cookie minted
 * under the old rules with no fresh authorization step.
 *
 * One-way cleanup, and deliberately conditional on the REQUEST carrying the
 * cookie: an unconditional `delete` emits `Set-Cookie` on every response, which
 * makes a CDN bypass its cache — the same trap documented on
 * `attachVisitorIdentity` for `/i/`. Remove this once no live browser can still
 * hold one.
 */
const RETIRED_IMPERSONATE_COOKIE = "fm_impersonate";

export async function proxy(request: NextRequest) {
  try {
    const response = await attachVisitorIdentity(
      request,
      await runProxy(request),
    );
    if (request.cookies.has(RETIRED_IMPERSONATE_COOKIE)) {
      response.cookies.delete(RETIRED_IMPERSONATE_COOKIE);
    }
    return response;
  } catch (error) {
    // Fired before the rethrow and deliberately not awaited: the capture is
    // asynchronous, and the request must fail exactly as it does today.
    reportProxyFailure("unhandled", error, "error");
    throw error;
  }
}

/**
 * Everything `runProxy` computes before the first step runs, plus the values
 * more than one step reads. Every field is fixed before the pipeline starts;
 * no step writes to the context, so a step depends only on its own position in
 * `PROXY_PIPELINE` and never on a variable an earlier step happened to set.
 */
export type ProxyContext = {
  readonly request: NextRequest;
  readonly pathname: string;
  readonly staging: boolean;
  readonly rateLimitDisabled: boolean;
  readonly routerRequest: boolean;
  readonly hasStagingE2ESession: boolean;
  /** Non-empty pathname segments, e.g. `["zh-TW", "brands", "x"]`. */
  readonly segments: string[];
  /** The brand-detail slug in the pathname, still percent-encoded. */
  readonly brandSlug: string | null;
  /** The pathname split into its locale prefix and the remaining path. */
  readonly directoryPath: { locale: string; path: string };
};

/**
 * One link in the proxy's chain of responsibility. Returning a response ends
 * the chain (the runner applies `finalizeResponse` to it); `undefined` hands
 * the request to the next step.
 */
export type ProxyStep = {
  readonly name: string;
  run(
    ctx: ProxyContext,
  ): Promise<NextResponse | undefined> | NextResponse | undefined;
};

export async function createProxyContext(
  request: NextRequest,
): Promise<ProxyContext> {
  const { pathname } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  return {
    request,
    pathname,
    staging: isStagingRequest(request.headers.get("host")),
    // Two independent switches, not one flag. See `security/test-gates.ts`:
    // disabling the limiter and stubbing Turnstile used to be the same env var,
    // which is why no e2e project could exercise either gate on its own.
    rateLimitDisabled: isRateLimitDisabled(),
    routerRequest: isRouterRequest(request),
    hasStagingE2ESession: Boolean(
      await verifyStagingSession(
        request.cookies.get(E2E_STAGING_SESSION_COOKIE)?.value,
        request.headers.get("host"),
      ),
    ),
    segments,
    brandSlug: getBrandDetailSlug(segments),
    directoryPath: parseDirectoryPath(pathname),
  };
}

const stagingSitemap404: ProxyStep = {
  name: "stagingSitemap404",
  run({ staging, hasStagingE2ESession, pathname }) {
    if (staging && !hasStagingE2ESession && pathname === "/sitemap.xml") {
      return new NextResponse("Not found", { status: 404 });
    }
    return undefined;
  },
};

const stagingLockdown: ProxyStep = {
  name: "stagingLockdown",
  async run({ request, pathname, staging, hasStagingE2ESession }) {
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
    const isDeployedRuntime = Boolean(
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim(),
    );
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
      hasStagingE2ESession ||
      initiallyAllowed ||
      isAllowedStagingRequest(request.method, pathname, authenticated);

    if (!stagingRequestAllowed) {
      return NextResponse.json(
        { error: "This flow is disabled in staging" },
        { status: 403 },
      );
    }
    return undefined;
  },
};

/**
 * Sits above every step after it, and several of those are terminal -- the
 * auth callback and /admin/content return `next()` outright. With the guard
 * below them, those surfaces would reach the origin with no edge credential.
 * The guard is host-independent, and its only path-sensitivity is the explicit
 * exempt list, so running it first costs nothing.
 */
const originGuard: ProxyStep = {
  name: "originGuard",
  run({ request }) {
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
      // Exempt paths are called machine-to-machine straight at the Railway origin
      // (the public host is Cloudflare-fronted and bot-challenges those POSTs), so
      // they carry no edge credential and authenticate themselves inside their own
      // handler. /api/internal/revalidate-brands follows the same contract as
      // /api/cron/; the rest of /api/internal/ keeps this guard as a second layer
      // and is deliberately not exempt.
      const edgeSecret = request.headers.get("x-formoria-edge");
      if (
        edgeSecret !== cfOriginSecret &&
        !isOriginGuardExempt(request.nextUrl.pathname)
      ) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
    return undefined;
  },
};

/**
 * Workaround for a Next 16.3.x bug (DEV-2047). For an unknown action id on an
 * `RSC: 1` request, the action handler returns its text/plain "not found"
 * result, then the page runtime throws InvariantError E789 ("Expected RSC
 * response, got text/plain") because `cacheComponents` is off: a 500 on every
 * path. This step answers with the exact 404 Next gives a legitimate unknown
 * action. It sits above the terminal passthroughs because /admin/content pages
 * carry server actions, and below `originGuard` so bypass traffic is still
 * rejected there first.
 *
 * Remove once Next answers this header pair with a 404 itself: delete the step
 * and confirm a forged POST (Next-Action + RSC: 1) against `next start` 404s.
 */
const forgedRscAction404: ProxyStep = {
  name: "forgedRscAction404",
  run({ request }) {
    if (!isForgedRscActionRequest(request)) return undefined;
    return new NextResponse("Server action not found.", {
      status: 404,
      headers: {
        "content-type": "text/plain",
        "x-nextjs-action-not-found": "1",
      },
    });
  },
};

const authCallbackPassthrough: ProxyStep = {
  name: "authCallbackPassthrough",
  run({ pathname }) {
    return pathname === routes.auth.callback() ? NextResponse.next() : undefined;
  },
};

const adminContentPassthrough: ProxyStep = {
  name: "adminContentPassthrough",
  run({ pathname }) {
    return pathname.startsWith(routes.admin.content())
      ? NextResponse.next()
      : undefined;
  },
};

const pathNormalization: ProxyStep = {
  name: "pathNormalization",
  run({ request, pathname }) {
    const normalizedPathname = normalizePathname(pathname);
    if (normalizedPathname !== pathname) {
      const url = request.nextUrl.clone();
      url.pathname = normalizedPathname;
      return NextResponse.redirect(url, 301);
    }
    return undefined;
  },
};

const legacyCategoryRedirect: ProxyStep = {
  name: "legacyCategoryRedirect",
  run({ request, directoryPath }) {
    const legacyCategorySegments = directoryPath.path
      .split("/")
      .filter(Boolean);
    if (
      legacyCategorySegments.length === 2 &&
      legacyCategorySegments[0] === "category"
    ) {
      const category = legacyCategorySegments[1] ?? "";
      if (!isVisibleCategory(category)) {
        return new NextResponse(null, { status: 410 });
      }

      const destination = localizePath(
        routes.discover({ category }),
        directoryPath.locale,
      );
      return NextResponse.redirect(new URL(destination, request.url), 301);
    }
    return undefined;
  },
};

/**
 * /discover streams behind loading.tsx, so the page's own notFound() for an
 * unknown category lands after a 200 status line. Answer it here instead so
 * a deferred or retired category URL stays a real 404 (DS-34).
 */
const discoverCategory404: ProxyStep = {
  name: "discoverCategory404",
  run({ request, directoryPath }) {
    if (
      directoryPath.path === "/discover" &&
      hasUnknownDiscoverCategory(request.nextUrl.searchParams)
    ) {
      return rewriteToLocalizedNotFound(request, directoryPath.locale);
    }
    return undefined;
  },
};

/**
 * Below the pathname normalization 301. A crawler that requests a
 * non-canonical path would otherwise be
 * counted once for the redirect and again when it follows it.
 *
 * `isLikelyCrawler` is one precompiled union regex; `recordCrawlerHit`
 * re-scans the registry entry by entry. Gating on it keeps the
 * human-traffic common case at a single test.
 *
 * Side effect only: this step never ends the chain.
 */
const crawlerTelemetry: ProxyStep = {
  name: "crawlerTelemetry",
  run({ request }) {
    if (!isCrawlerTelemetrySuppressed() && isLikelyCrawler(request)) {
      recordCrawlerHit(request);
    }
    return undefined;
  },
};

/** Check rate limit before regular request processing. */
const rateLimit: ProxyStep = {
  name: "rateLimit",
  async run({ request, rateLimitDisabled, hasStagingE2ESession }) {
    if (!rateLimitDisabled && !hasStagingE2ESession) {
      const rateLimitResponse = await checkRateLimit(request);
      if (rateLimitResponse) return rateLimitResponse;
    }
    return undefined;
  },
};

const softRateLimit: ProxyStep = {
  name: "softRateLimit",
  async run({
    request,
    pathname,
    rateLimitDisabled,
    hasStagingE2ESession,
    routerRequest,
  }) {
    if (
      rateLimitDisabled ||
      hasStagingE2ESession ||
      routerRequest ||
      !isSoftLimitPath(pathname)
    ) {
      return undefined;
    }

    const challengeCookie = request.cookies.get(CHALLENGE_COOKIE_NAME)?.value;
    let isVerified = false;
    if (challengeCookie) {
      try {
        isVerified = await verifyChallengeToken(
          challengeCookie,
          getClientIp(request),
        );
      } catch (error) {
        reportProxyFailure("challenge-token", error, "warning");
        isVerified = false;
      }
    }

    // NO LONGER A SHORT-CIRCUIT. Until DEV-1551 a valid `fm_verified` cookie
    // skipped this whole block, so one Turnstile solve bought seven days of
    // unmetered `/brands/*` traversal — the cheapest way to scrape the
    // directory was to pass the challenge once. Verification now buys a RAISED
    // budget (ENFORCEMENT_VERIFIED_MULTIPLIER), evaluated on the same counter.
    const overSoftLimit = await checkSoftRateLimit(request, {
      verified: isVerified,
    });
    if (overSoftLimit) {
      // Escalation, not a loop. Re-challenging someone who already holds a
      // valid token would bounce them between /challenge and /brands until the
      // window rolled, so an exhausted RAISED budget goes straight to the 429
      // rung instead. An unverified visitor still gets the gentler rung first.
      if (isVerified) {
        return softLimitBlockedResponse();
      }

      const url = request.nextUrl.clone();
      url.pathname = routes.challenge();
      url.searchParams.set("returnTo", pathname + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return undefined;
  },
};

const brandSlugRedirect: ProxyStep = {
  name: "brandSlugRedirect",
  async run({ request, segments, brandSlug }) {
    if (!brandSlug) return undefined;

    let decodedSlug: string;
    try {
      decodedSlug = decodeURIComponent(brandSlug);
    } catch (error) {
      reportProxyFailure("slug-decode", error, "warning");
      // Not rewritten to the branded page: Next decodes the original URL even
      // after a rewrite and answers 500. Malformed percent-encoding never comes
      // from a real link, so an empty 404 is enough.
      return new NextResponse(null, { status: 404 });
    }

    const redirectSlug = await resolveApprovedBrandRedirect(decodedSlug);
    if (redirectSlug) {
      const url = request.nextUrl.clone();
      const locale = isAppLocale(segments[0]) ? segments[0] : "zh-TW";
      url.pathname = localizePath(routes.brand(redirectSlug), locale);
      return NextResponse.redirect(url, 308);
    }
    return undefined;
  },
};

const malformedDetailSlug404: ProxyStep = {
  name: "malformedDetailSlug404",
  run({ segments }) {
    const publicDetailOffset = isAppLocale(segments.at(0)) ? 1 : 0;
    const publicDetailSection = segments.at(publicDetailOffset);
    const publicDetailSlug = segments.at(publicDetailOffset + 1);
    if (
      publicDetailSlug &&
      segments.length === publicDetailOffset + 2 &&
      ["brands", "stories", "style"].includes(publicDetailSection ?? "")
    ) {
      const decodedSlug = safeDecodeSlug(publicDetailSlug);
      // Locale rewriting decodes %25 to a bare percent that Next cannot decode.
      if (decodedSlug === null || decodedSlug.includes("%")) {
        return new NextResponse(null, { status: 404 });
      }
    }
    return undefined;
  },
};

/**
 * Redirect top-level brand slugs: /:slug → /brands/:slug (301 for SEO continuity)
 * Only applies to single-segment paths that match the brand slug format
 * and are not reserved app routes or locale prefixes.
 */
const bareBrandSlugRedirect: ProxyStep = {
  name: "bareBrandSlugRedirect",
  async run({ request, segments }) {
    if (segments.length !== 1) return undefined;
    const slug = segments[0];
    if (
      KNOWN_LOCALES.has(slug) ||
      RESERVED_ROUTES.has(slug) ||
      !SLUG_PATTERN.test(slug)
    ) {
      return undefined;
    }

    // A failed existence check must retain the old redirect behavior so a
    // transient Supabase outage cannot make a real brand unavailable.
    let isApproved = true;
    try {
      isApproved = await hasApprovedBrandSlug(slug);
    } catch (error) {
      reportProxyFailure("brand-approval", error, "error");
      isApproved = true;
    }

    const decision = decideBareBrandSlug(slug, isApproved);
    if (decision.action === "not-found") {
      return rewriteToLocalizedNotFound(request, "zh-TW");
    }

    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.redirect(url, decision.status);
  },
};

const outsideApp404: ProxyStep = {
  name: "outsideApp404",
  run({ request, pathname }) {
    return isOutsideAppRoutes(pathname)
      ? rewriteToLocalizedNotFound(request, "zh-TW")
      : undefined;
  },
};

/** Terminal step: always returns, so the chain never falls through. */
const intl: ProxyStep = {
  name: "intl",
  async run({ request, pathname, segments, brandSlug, routerRequest }) {
    const isPublicPath = isLocalizedPublicPath(pathname);
    const explicitLocale = isAppLocale(segments.at(0)) ? segments.at(0) : null;
    // No locale is inferred from the request. A prefixless public URL is always
    // the default locale, which is what `src/i18n/routing.ts` already declares
    // with `localeDetection: false`. English is reached only by an explicit
    // choice: the locale switcher writes `NEXT_LOCALE` through a server action,
    // and `/en/...` prefixes are honoured as written. Inferring here varied every
    // prefixless page on `accept-language` and `cf-ipcountry` with no `Vary`
    // header, so the edge could hand a cached zh-TW page to an English visitor --
    // and the redirect it issued was `private, no-store`, which took the whole
    // directory out of the edge cache for exactly the cold visitors it serves.

    let response: NextResponse;
    const isPrefixlessBrandDetail =
      brandSlug !== null && explicitLocale === null;
    if (isPrefixlessBrandDetail) {
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

    // No locale cookie is written on this path, on purpose. Writing one would add
    // a Set-Cookie that makes every HTML response uncacheable at Cloudflare -- and
    // the first cookie-less visit is exactly the request the edge most needs to
    // serve from cache.
    //
    // URL prefixes control only the current request. Explicit preferences are
    // persisted by the switcher, auth, and settings flows instead.

    if (
      isDirectoryIndexPath(pathname, request.nextUrl.search) &&
      !routerRequest &&
      !response.headers.has("set-cookie")
    ) {
      response.headers.set("Cache-Control", DIRECTORY_EDGE_CACHE_CONTROL);
    }

    // Skip Supabase auth refresh for truly public content paths to reduce egress.
    // settings still needs auth even though
    // isLocalizedPublicPath returns true for it (it's in PUBLIC_INTL_SEGMENTS).
    if (isPublicPath) {
      const segment =
        segments.length > 0 && KNOWN_LOCALES.has(segments[0])
          ? segments[1]
          : segments[0];
      // 'auth' is here because the auth pages call redirectIfAuthenticated(), which
      // needs a live Supabase session — skipping the refresh would silently strand
      // already-signed-in users on the sign-in form.
      const AUTH_REQUIRED_SEGMENTS = new Set([
        "auth",
        "settings",
        "submit",
        "admin",
        "favorites",
      ]);
      if (!AUTH_REQUIRED_SEGMENTS.has(segment)) {
        return response;
      }
    }

    return refreshSupabaseSession(request, response);
  },
};

/**
 * The proxy, as an ordered chain of responsibility.
 *
 * ORDER IS LOAD-BEARING. `originGuard` sits above every step after it, and
 * several of those are terminal -- `authCallbackPassthrough` and
 * `adminContentPassthrough` return `next()` outright. With the guard below
 * them, those surfaces would reach the origin with no edge credential.
 * `crawlerTelemetry` sits below `pathNormalization` so a redirected crawler is
 * counted once, and `intl` is last because it always returns. The exact order
 * is pinned by a test in `src/proxy.test.ts`; reordering a step is a behaviour
 * change and must update that test deliberately.
 */
export const PROXY_PIPELINE: readonly ProxyStep[] = [
  stagingSitemap404,
  stagingLockdown,
  originGuard,
  forgedRscAction404,
  authCallbackPassthrough,
  adminContentPassthrough,
  pathNormalization,
  legacyCategoryRedirect,
  discoverCategory404,
  crawlerTelemetry,
  rateLimit,
  softRateLimit,
  brandSlugRedirect,
  malformedDetailSlug404,
  bareBrandSlugRedirect,
  outsideApp404,
  intl,
];

async function runProxy(request: NextRequest): Promise<NextResponse> {
  const ctx = await createProxyContext(request);
  for (const step of PROXY_PIPELINE) {
    const response = await step.run(ctx);
    if (response) return finalizeResponse(response, ctx.staging);
  }
  // Unreachable while `intl` is last: it returns on every path.
  throw new Error("[proxy] PROXY_PIPELINE fell through without a response");
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
    /*
     * The same-origin image proxy, opted back in on purpose (DEV-1551). Its
     * paths end in `.webp`, so the extension exclusion above would skip them
     * and `/i/` traffic would bypass both the shared rate limiter and the
     * Cloudflare origin guard.
     */
    "/i/:path*",
  ],
};
