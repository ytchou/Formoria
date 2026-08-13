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
vi.mock("@/lib/security/crawler-telemetry", () => ({
  recordCrawlerHit: vi.fn(),
}));

vi.mock("@/lib/security/rate-limiter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/rate-limiter")>();
  return {
    ...actual,
    checkRateLimit: async () => null,
    checkSoftRateLimit: async () => false,
  };
});

const { proxy, isOriginGuardExempt } = await import("@/proxy");

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
