import { MAINTENANCE_PAGE } from "./page";

/**
 * DEV-1530 — the production maintenance gate.
 *
 * Closes formoria.com behind a branded 503 so the staging→production cutover
 * (DEV-1531) can push migrations, redeploy and repoint the origin without any
 * of it being publicly visible.
 *
 * WHY 503 AND NOT 200. A 200 "coming soon" page gets INDEXED as the site's
 * content, which teaches Google that Formoria is a placeholder and takes far
 * longer to undo than the outage itself. A 503 is the documented signal for
 * planned maintenance: crawlers back off and retry, nothing is indexed and
 * nothing is de-indexed. For the same reason this response must never carry an
 * `X-Robots-Tag: noindex` — that WOULD de-index, which is the opposite of the
 * intent.
 *
 * WHY A WORKER AND NOT `src/proxy.ts`. The in-app proxy is already the request
 * chokepoint and would be cleaner code, but it cannot cover the window where
 * the app itself is down, mid-deploy, or pointed at the wrong Supabase project
 * — which is exactly the window this gate exists for.
 *
 * MAX ~2 WEEKS. Google tolerates a sustained 503 as planned maintenance for
 * roughly two weeks; past that it starts dropping pages from the index. Treat
 * that as a deadline, not a target. The bypass cookie's Max-Age below is pinned
 * to the same ceiling so a forgotten gate and a forgotten bypass expire
 * together.
 */

interface Env {
  /**
   * Operator bypass. Set with `wrangler secret put GATE_BYPASS_TOKEN`.
   *
   * Unset means NO bypass is possible — the gate fails closed. That is the
   * correct default: a gate with an accidentally-empty bypass token that
   * compared equal to a missing cookie would be no gate at all.
   */
  GATE_BYPASS_TOKEN?: string;
}

/**
 * Advertised back-off. Crawlers mostly schedule on their own signals, but an
 * hour is the honest number for a cutover measured in hours, and it keeps
 * Google's retry cadence tight enough that the site is re-crawled soon after
 * the route is switched off.
 */
const RETRY_AFTER_SECONDS = 3600;

const BYPASS_COOKIE = "formoria-gate-bypass";
const BYPASS_QUERY_PARAM = "gate-bypass";
/** 14 days — the ticket's stated ceiling for how long the gate may stay up. */
const BYPASS_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

/**
 * NO-STORE IS LOAD-BEARING, NOT HYGIENE. A 503 cached at the Cloudflare edge or
 * in a browser would outlive the route being switched off, so the gate would
 * keep serving after it was lifted. `CDN-Cache-Control` is the one Cloudflare's
 * own cache reads.
 */
const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Retry-After": String(RETRY_AFTER_SECONDS),
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * Constant-time token comparison.
 *
 * SHA-256 first, then a fixed 32-byte XOR sweep: hashing makes the comparison
 * LENGTH-INDEPENDENT, which a plain byte-by-byte sweep is not — a raw compare
 * still leaks the expected token's length through the loop bound, and a
 * short-circuit `===` leaks the matching prefix. Both digests are always
 * computed and all 32 bytes are always visited, so the timing carries no
 * information about the secret.
 *
 * `crypto.subtle` is available in the Workers runtime, so this costs an await
 * on a path that already awaits a subrequest.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let index = 0; index < bytesA.length; index += 1) {
    diff |= bytesA[index] ^ bytesB[index];
  }
  return diff === 0;
}

async function isBypassAuthorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.GATE_BYPASS_TOKEN;
  // Unset token fails closed before any compare: hashing "" against "" would
  // match, which would turn a missing secret into a wide-open gate.
  if (!expected) return false;
  const offered = readCookie(request, BYPASS_COOKIE);
  if (offered === null) return false;
  return timingSafeEqual(offered, expected);
}

/**
 * `/api/*` gets JSON, everything else gets the page.
 *
 * The gate deliberately covers `/api/*` too — the ticket's rule is that a
 * half-open surface defeats the purpose — but handing an HTML document to a
 * fetch() caller expecting JSON produces a parse error instead of a readable
 * status, so the shape follows the path.
 */
function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

const maintenanceGate = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Arriving with `?gate-bypass=<token>` mints the cookie and redirects to the
    // clean URL, so the token stops travelling in the address bar, in Referer,
    // and in Cloudflare's own request logs after the first hop.
    const offeredToken = url.searchParams.get(BYPASS_QUERY_PARAM);
    if (
      offeredToken &&
      env.GATE_BYPASS_TOKEN &&
      (await timingSafeEqual(offeredToken, env.GATE_BYPASS_TOKEN))
    ) {
      url.searchParams.delete(BYPASS_QUERY_PARAM);
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          "Set-Cookie": `${BYPASS_COOKIE}=${env.GATE_BYPASS_TOKEN}; Path=/; Max-Age=${BYPASS_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store",
        },
      });
    }

    // An authorized operator sees the real site. On a route-bound Worker a
    // same-zone subrequest goes to the origin rather than back through this
    // Worker, so this does not recurse.
    if (await isBypassAuthorized(request, env)) {
      return fetch(request);
    }

    if (isApiPath(url.pathname)) {
      return new Response(
        JSON.stringify({
          error: "service_unavailable",
          message: "Formoria is temporarily closed for scheduled maintenance.",
          retryAfter: RETRY_AFTER_SECONDS,
        }),
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }

    // HEAD must carry the same status and headers with no body — `curl -I` is
    // the ticket's own verification command.
    const body = request.method === "HEAD" ? null : MAINTENANCE_PAGE;

    return new Response(body, {
      status: 503,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Language": "zh-Hant-TW",
      },
    });
  },
};

export default maintenanceGate;
