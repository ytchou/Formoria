import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boundary mocks only: the origin guard runs near the top of `proxy()`, but a
 * request that PASSES the guard keeps falling through to the rate limiter
 * (Redis) and the Supabase session refresh (Auth server). Both are system
 * edges; everything between them — pathname normalization, the exempt-path
 * predicate, the guard itself — runs for real.
 *
 * The rate limiter is stubbed here. Supabase is NOT mocked — mocking it is
 * forbidden by `scripts/check-test-boundaries.mjs`. Instead every test below
 * blanks `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which
 * makes `refreshSupabaseSession` return the response untouched: no client is
 * constructed and no Auth call is made, regardless of what the ambient
 * environment happens to have configured. The session refresh is downstream of
 * the origin guard, so it cannot affect any assertion in this file.
 *
 * That blanking also trips the missing-credentials guard, which logs one
 * `console.error` per process by design (in production the same condition is a
 * silent site-wide logout). The single line in this suite's output is expected.
 */
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

vi.mock("@/lib/security/crawler-telemetry", () => ({
  recordCrawlerHit: vi.fn(),
}));

const limiter = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async (_request: unknown): Promise<null> => null),
  checkSoftRateLimit: vi.fn(
    async (_request: unknown, _options?: unknown): Promise<boolean> => false,
  ),
}));

vi.mock("@/lib/security/rate-limiter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/rate-limiter")>();
  return {
    ...actual,
    checkRateLimit: limiter.checkRateLimit,
    checkSoftRateLimit: limiter.checkSoftRateLimit,
  };
});

const { proxy, isOriginGuardExempt, resetProxyTelemetryForTests, config } =
  await import("@/proxy");

const EDGE_SECRET = "cf-edge-9f3b7c21ae4d48e0b6a15c73d2f0e884";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function requestFor(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://formoria.com${pathname}`), {
    headers: { "user-agent": BROWSER_UA, ...headers },
  });
}

async function withRedirectLookupServer<T>(callback: () => Promise<T>) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Redirect lookup test server did not expose a port");
  }

  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");

  try {
    return await callback();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  // `mockReset`, not `mockImplementation` alone. Vitest is not configured with
  // `clearMocks`, so call history survives across cases in this file: any test
  // asserting a CALL COUNT would otherwise read the sum of every earlier case
  // that reached the same call site.
  limiter.checkRateLimit.mockReset();
  limiter.checkSoftRateLimit.mockReset();
  limiter.checkRateLimit.mockImplementation(async () => null);
  limiter.checkSoftRateLimit.mockImplementation(async () => false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("origin guard exempt paths", () => {
  it("exempts /api/health and everything beneath it — Railway probes it from inside its own network with no edge header, so a 403 here would fail every deploy health check forever, including the deploy that would fix it", () => {
    expect(isOriginGuardExempt("/api/health")).toBe(true);
    expect(isOriginGuardExempt("/api/health/deep")).toBe(true);
  });

  it("exempts every /api/cron/ route by prefix", () => {
    expect(isOriginGuardExempt("/api/cron/refresh-brand-metrics")).toBe(true);
    expect(isOriginGuardExempt("/api/cron/")).toBe(true);
  });

  it("exempts /api/internal/revalidate-brands exactly, leaving the rest of /api/internal/ guarded", () => {
    expect(isOriginGuardExempt("/api/internal/revalidate-brands")).toBe(true);
    expect(isOriginGuardExempt("/api/internal/revalidate-brands/extra")).toBe(
      false,
    );
    expect(isOriginGuardExempt("/api/internal/purge-cache")).toBe(false);
    expect(isOriginGuardExempt("/api/internal")).toBe(false);
  });

  it("does not exempt ordinary application paths", () => {
    expect(isOriginGuardExempt("/brands/kinship-goods")).toBe(false);
    expect(isOriginGuardExempt("/api/admin/brands")).toBe(false);
    expect(isOriginGuardExempt("/")).toBe(false);
  });
});

describe("a request arriving at the origin in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CF_ORIGIN_SECRET", EDGE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is served when it carries the edge credential in the new x-formoria-edge header", async () => {
    const response = await proxy(
      requestFor("/api/admin/brands", { "x-formoria-edge": EDGE_SECRET }),
    );
    expect(response.status).not.toBe(403);
  });

  it("is still served when it carries the edge credential in the legacy x-origin-verify header — the fallback that keeps production alive until the Cloudflare rule ships", async () => {
    const response = await proxy(
      requestFor("/api/admin/brands", { "x-origin-verify": EDGE_SECRET }),
    );
    expect(response.status).not.toBe(403);
  });

  it("is rejected when the new header is present but wrong, even if the legacy header is correct — the new header must win outright, or the zone-wide transform rule would override the migration", async () => {
    const response = await proxy(
      requestFor("/api/admin/brands", {
        "x-formoria-edge": "cf-edge-stale-rotated-value",
        "x-origin-verify": EDGE_SECRET,
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Forbidden");
  });

  it("is rejected on a non-exempt path when it carries no credential at all", async () => {
    const response = await proxy(requestFor("/api/admin/brands"));
    expect(response.status).toBe(403);
  });

  it("reaches /api/health with no credential — Railway health probes originate inside the private network and never pass through Cloudflare, so a 403 here bricks every future deploy", async () => {
    const response = await proxy(requestFor("/api/health"));
    expect(response.status).not.toBe(403);
  });

  it("reaches a pg_cron job route with no edge credential — cron callers hit the Railway origin directly and authenticate themselves inside the handler", async () => {
    const response = await proxy(requestFor("/api/cron/refresh-brand-metrics"));
    expect(response.status).not.toBe(403);
  });

  it("reaches /api/internal/revalidate-brands with no edge credential", async () => {
    const response = await proxy(requestFor("/api/internal/revalidate-brands"));
    expect(response.status).not.toBe(403);
  });

  it("is rejected on the rest of /api/internal/, which is deliberately not exempt", async () => {
    const response = await proxy(requestFor("/api/internal/purge-cache"));
    expect(response.status).toBe(403);
  });
});

describe("the origin guard when it is not configured to run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets an uncredentialed request through when CF_ORIGIN_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CF_ORIGIN_SECRET", "");
    const response = await proxy(requestFor("/api/admin/brands"));
    expect(response.status).not.toBe(403);
  });

  it("lets an uncredentialed request through outside production, so local development needs no edge header", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CF_ORIGIN_SECRET", EDGE_SECRET);
    const response = await proxy(requestFor("/api/admin/brands"));
    expect(response.status).not.toBe(403);
  });
});

describe("default-locale URL canonicalization", () => {
  // Bug: an external request forged with next-intl's internal locale header
  // must not bypass the canonical redirect for the default locale.
  it("canonicalizes a forged default-locale directory request while rewriting the bare URL", async () => {
    const bareResponse = await proxy(requestFor("/brands"));
    expect(bareResponse.status).toBe(200);
    expect(bareResponse.headers.get("x-middleware-rewrite")).toMatch(
      /\/zh-TW\/brands$/,
    );

    const forgedResponse = await proxy(
      requestFor("/zh-TW/brands", {
        "X-NEXT-INTL-LOCALE": "zh-TW",
      }),
    );
    expect(forgedResponse.status).toBe(307);
    expect(forgedResponse.headers.get("location")).toMatch(/\/brands$/);
  });

  // Bug: a bare default-locale brand detail must reach its exact route, while
  // a client-forged next-intl locale header must not bypass canonicalization.
  it("passes a bare brand detail through without an intl rewrite while a forged default-locale detail still redirects", async () => {
    await withRedirectLookupServer(async () => {
      const bareResponse = await proxy(requestFor("/brands/hero-herb"));
      expect(bareResponse.status).toBe(200);
      expect(bareResponse.headers.get("x-middleware-rewrite")).toBeNull();

      const forgedResponse = await proxy(
        requestFor("/zh-TW/brands/hero-herb", {
          "X-NEXT-INTL-LOCALE": "zh-TW",
        }),
      );
      expect(forgedResponse.status).toBe(307);
      expect(forgedResponse.headers.get("location")).toMatch(
        /\/brands\/hero-herb$/,
      );
    });
  });
});

/**
 * Turbopack skips the Sentry SDK's webpack middleware auto-wrap, so `proxy()`
 * reports its own failures by hand. Each case drives a capture site through a
 * REAL failure — no Supabase or service-layer mock — and asserts the
 * observability is additive: same status, same branch, same fallbacks.
 *
 * `vi.resetModules()` is deliberately NOT used here. Only the first dynamic
 * `import('@sentry/nextjs')` after a module reset resolves to the mock; later
 * ones reach the real SDK, which silently drops every assertion.
 * `resetProxyTelemetryForTests()` clears the module-scoped throttle map and the
 * missing-credentials latch instead, so every case starts from a clean slate
 * with no clock arithmetic.
 */
describe("proxy failure reporting", () => {
  const CRAWLER_UA =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const SUPABASE_URL = "https://example.supabase.co";
  const SESSION_COOKIE = "sb-example-auth-token";

  beforeEach(() => {
    resetProxyTelemetryForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    sentry.captureException.mockReset();
    sentry.captureException.mockImplementation(() => "event-id");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The capture rides a `.then()` on a dynamic import, so it needs a macrotask
   *  turn before it is observable. */
  async function flushCaptures() {
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function capturesFor(area: string) {
    return sentry.captureException.mock.calls.filter(
      (call) => (call[1] as { tags?: { area?: string } })?.tags?.area === area,
    );
  }

  function optionsOf(call: unknown[]) {
    return call[1] as { level: string; fingerprint: string[] };
  }

  /**
   * Makes `supabase.auth.getUser()` reject rather than resolve, without mocking
   * Supabase: a signed-in cookie forces the client to call the Auth server, and
   * a `fetch` that resolves to a non-Response makes auth-js throw a TypeError
   * it does not recognise as an AuthError. Throwing from the cookie adapter
   * instead would also reject auth-js's own un-awaited INITIAL_SESSION emit.
   */
  function stubUnreachableAuthServer() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", async () => undefined);
  }

  function signedInCookie() {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const accessToken = [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({
        sub: "11111111-1111-1111-1111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        exp: nowSeconds + 3600,
      }),
      "signature",
    ].join(".");
    const session = {
      access_token: accessToken,
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: nowSeconds + 3600,
      user: {
        id: "11111111-1111-1111-1111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "member@formoria.com",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    };
    return `${SESSION_COOKIE}=base64-${encode(session)}`;
  }

  it("reports an unhandled proxy exception and rethrows it", async () => {
    const { recordCrawlerHit } = await import(
      "@/lib/security/crawler-telemetry"
    );
    const failure = new Error("crawler telemetry exploded");
    vi.mocked(recordCrawlerHit).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      proxy(requestFor("/", { "user-agent": CRAWLER_UA })),
    ).rejects.toBe(failure);

    await flushCaptures();

    const captures = capturesFor("unhandled");
    expect(captures).toHaveLength(1);
    expect(captures[0][0]).toBe(failure);
    expect(
      (captures[0][1] as { tags: { scope: string } }).tags.scope,
    ).toBe("proxy");
    expect(optionsOf(captures[0]).level).toBe("error");
  });

  it("lets Sentry group unhandled proxy crashes by their own stack, so a second root cause is a second issue rather than a count on the first", async () => {
    const { recordCrawlerHit } = await import(
      "@/lib/security/crawler-telemetry"
    );
    const first = new Error("crawler telemetry exploded");
    const second = new TypeError("locale rewrite exploded");

    vi.mocked(recordCrawlerHit).mockImplementationOnce(() => {
      throw first;
    });
    await expect(
      proxy(requestFor("/", { "user-agent": CRAWLER_UA })),
    ).rejects.toBe(first);
    await flushCaptures();

    // Past the throttle window, so the second root cause is not suppressed.
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    vi.mocked(recordCrawlerHit).mockImplementationOnce(() => {
      throw second;
    });
    await expect(
      proxy(requestFor("/", { "user-agent": CRAWLER_UA })),
    ).rejects.toBe(second);
    await flushCaptures();

    const captures = capturesFor("unhandled");
    expect(captures).toHaveLength(2);
    expect(captures.map((call) => call[0])).toEqual([first, second]);
    // No explicit fingerprint at this site: a fixed one would fold both errors
    // into a single already-triaged issue and raise no new-issue alert.
    expect(optionsOf(captures[0]).fingerprint).toBeUndefined();
    expect(optionsOf(captures[1]).fingerprint).toBeUndefined();
  });

  it("reports a Supabase failure during the brand-approval check without changing the response", async () => {
    // The blanked credentials make the edge service client throw on
    // construction — from the proxy's side, the same shape as an outage.
    const response = await proxy(requestFor("/hero-herb"));

    // Fail-open preserved: the slug is still served as an approved brand.
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toMatch(/\/brands\/hero-herb$/);

    await flushCaptures();

    const captures = capturesFor("brand-approval");
    expect(captures).toHaveLength(1);
    expect(optionsOf(captures[0]).level).toBe("error");
  });

  it("reports missing Supabase credentials", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const response = await proxy(requestFor("/dashboard"));
      expect(response.status).toBeLessThan(400);
      await flushCaptures();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(capturesFor("supabase-credentials")).toHaveLength(1);

      // Missing credentials is an every-request condition, so both channels sit
      // behind the same one-shot latch: a second request announces nothing.
      const repeat = await proxy(requestFor("/dashboard"));
      expect(repeat.status).toBeLessThan(400);
      await flushCaptures();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(capturesFor("supabase-credentials")).toHaveLength(1);
    } finally {
      consoleError.mockRestore();
    }

    const captures = capturesFor("supabase-credentials");
    expect(optionsOf(captures[0]).level).toBe("error");
  });

  it("reports the fail-closed auth-check at error level and the gracefully degrading session-refresh at warning level", async () => {
    stubUnreachableAuthServer();

    // Auth check: the staging mutation lockdown asks whether the caller is
    // signed in. A failed answer must still settle closed.
    const stagingPost = new NextRequest(
      new URL("https://staging.formoria.com/submit"),
      {
        method: "POST",
        headers: {
          host: "staging.formoria.com",
          "user-agent": BROWSER_UA,
          cookie: signedInCookie(),
        },
      },
    );
    const lockedDown = await proxy(stagingPost);
    expect(lockedDown.status).toBe(403);

    // Session refresh: the request continues, unauthenticated.
    const refreshed = await proxy(
      requestFor("/dashboard", { cookie: signedInCookie() }),
    );
    expect(refreshed.status).toBeLessThan(400);

    await flushCaptures();

    const authCheck = capturesFor("auth-check");
    const sessionRefresh = capturesFor("session-refresh");
    expect(authCheck).toHaveLength(1);
    expect(sessionRefresh).toHaveLength(1);
    // The auth check settles CLOSED — the signed-in caller just got a 403 — so
    // it must clear an alert threshold set at error. The session refresh only
    // degrades to anonymous, which is the correct outcome, so it stays warning.
    expect(optionsOf(authCheck[0]).level).toBe("error");
    expect(optionsOf(sessionRefresh[0]).level).toBe("warning");
  });

  it("throttles repeated captures from the same site", async () => {
    const start = Date.now();

    await proxy(requestFor("/hero-herb"));
    await flushCaptures();
    expect(capturesFor("brand-approval")).toHaveLength(1);

    // Inside the 5-minute window: silent.
    vi.setSystemTime(start + 4 * 60 * 1000);
    await proxy(requestFor("/hero-herb"));
    await flushCaptures();
    expect(capturesFor("brand-approval")).toHaveLength(1);

    // Past the window: reported again.
    vi.setSystemTime(start + 6 * 60 * 1000);
    await proxy(requestFor("/hero-herb"));
    await flushCaptures();
    expect(capturesFor("brand-approval")).toHaveLength(2);
  });

  it("each capture site carries a distinct fingerprint", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      // Flushed between the two requests: two `import('@sentry/nextjs')` calls
      // issued before the first settles race in Vitest's mock registry, and the
      // second resolves to the real SDK.
      await proxy(requestFor("/hero-herb"));
      await flushCaptures();
      await proxy(requestFor("/dashboard"));
      await flushCaptures();
    } finally {
      consoleError.mockRestore();
    }

    const brandApproval = capturesFor("brand-approval");
    const credentials = capturesFor("supabase-credentials");
    expect(brandApproval).toHaveLength(1);
    expect(credentials).toHaveLength(1);

    expect(optionsOf(brandApproval[0]).fingerprint).toEqual([
      "proxy",
      "brand-approval",
    ]);
    expect(optionsOf(credentials[0]).fingerprint).toEqual([
      "proxy",
      "supabase-credentials",
    ]);
    expect(optionsOf(brandApproval[0]).fingerprint).not.toEqual(
      optionsOf(credentials[0]).fingerprint,
    );
  });

  it("a capture failure never breaks the request", async () => {
    sentry.captureException.mockImplementation(() => {
      throw new Error("Sentry transport is down");
    });

    const response = await proxy(requestFor("/hero-herb"));
    await flushCaptures();

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toMatch(/\/brands\/hero-herb$/);
    expect(sentry.captureException).toHaveBeenCalled();
  });
});

describe("proxy matcher", () => {
  it("includes /i/ so the image proxy is processed, not skipped", () => {
    const [defaultPattern, imageProxyPattern, ...rest] = config.matcher;

    /*
     * `/i/brands/<id>/hero.webp` ends in an image extension, which the default
     * pattern excludes. Without the second entry the image proxy would bypass
     * the shared rate limiter and the Cloudflare origin guard entirely.
     */
    expect(new RegExp(`^${defaultPattern}$`).test("/i/brands/x.webp")).toBe(
      false,
    );
    expect(imageProxyPattern).toBe("/i/:path*");
    expect(rest).toEqual([]);
    // And the guard really does apply to it: /i/ is not on the exempt list.
    expect(isOriginGuardExempt("/i/brands/x.webp")).toBe(false);
  });
});

/**
 * DEV-1551 task 15. `src/proxy.ts` used to treat a valid `fm_verified` cookie as
 * an unconditional seven-day pass: the whole soft-limit block was skipped, so
 * solving Turnstile once bought a week of unmetered `/brands/*` traversal.
 * Verification now buys a RAISED budget, evaluated on the same counter.
 */
describe("the soft-limit budget a verified visitor gets", () => {
  const SOFT_LIMIT_PATH = "/brands/kinship-goods";

  beforeEach(() => {
    vi.stubEnv("SECURITY_DISABLE_RATE_LIMIT", "false");
    vi.stubEnv("PLAYWRIGHT_TEST", "false");
    vi.stubEnv("CHALLENGE_SECRET", "proxy-test-challenge-secret");
  });

  async function verifiedCookieHeader(): Promise<string> {
    const { signChallengeToken, CHALLENGE_COOKIE_NAME } = await import(
      "@/lib/security/challenge"
    );
    return `${CHALLENGE_COOKIE_NAME}=${await signChallengeToken("203.0.113.5")}`;
  }

  it("still evaluates the soft limit for a verified visitor", async () => {
    // Passing the soft limit lets the request fall through to the brand
    // redirect lookup, which needs a reachable Supabase endpoint. The two
    // tests below return before reaching it.
    const cookie = await verifiedCookieHeader();
    await withRedirectLookupServer(() =>
      proxy(requestFor(SOFT_LIMIT_PATH, { cookie })),
    );

    // The call itself is the assertion: before this change the cookie skipped it.
    expect(limiter.checkSoftRateLimit).toHaveBeenCalledTimes(1);
    expect(limiter.checkSoftRateLimit.mock.calls[0]?.[1]).toEqual({
      verified: true,
    });
  });

  it("escalates a verified visitor to 429 rather than re-challenging them", async () => {
    limiter.checkSoftRateLimit.mockImplementation(async () => true);

    const response = await proxy(
      requestFor(SOFT_LIMIT_PATH, { cookie: await verifiedCookieHeader() }),
    );

    // A redirect back to /challenge would bounce a visitor who already holds a
    // valid token between two pages until the window rolled.
    expect(response.status).toBe(429);
  });

  it("still sends an unverified visitor to the challenge first", async () => {
    limiter.checkSoftRateLimit.mockImplementation(async () => true);

    const response = await proxy(requestFor(SOFT_LIMIT_PATH));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/challenge");
    expect(limiter.checkSoftRateLimit.mock.calls[0]?.[1]).toEqual({
      verified: false,
    });
  });
});
