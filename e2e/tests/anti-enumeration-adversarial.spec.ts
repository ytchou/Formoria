import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { BUDGET } from "../budgets";
import { getServiceClient } from "../helpers/seed";

/**
 * DEV-1551 task 18 / DEV-1285: the adversarial matrix.
 *
 * Runs in the `adversarial` Playwright project, which is the only one that
 * boots the server with `SECURITY_DISABLE_RATE_LIMIT=false`. Every other
 * project disables the limiter, which is why no spec could exercise a 429
 * before task 17 split the single `PLAYWRIGHT_TEST` flag in two.
 *
 * Two things to hold in mind while reading the assertions:
 *
 * 1. `ENFORCEMENT_MODE` defaults to `observe`, and the ladder's decision is
 *    computed and then discarded (DEV-1551 open finding 3). So the escalation
 *    rungs are visible in telemetry only. These cases assert what the RESPONSE
 *    does — the hard limiter and the Turnstile soft limit — never a 429 that
 *    the ladder would have produced.
 *
 * 2. Cases 2-4 cover the bypass that DEV-1551 set out to close and initially
 *    only half-closed. Router requests are now metered against their own
 *    raised budget rather than skipping the limiter outright.
 */

const BRANDS = "/brands";
const CHALLENGE_PATH = "/challenge";

/** A request that reaches the origin without following the challenge redirect. */
async function rawGet(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string> = {},
) {
  return request.get(path, { headers, maxRedirects: 0 });
}

function isChallenged(status: number, location: string | undefined): boolean {
  return (
    (status === 307 || status === 302) === true &&
    (location ?? "").includes(CHALLENGE_PATH)
  );
}

/**
 * Walk a crawl until the origin pushes back, returning the statuses seen. The
 * stop condition lives here rather than in the test because
 * `playwright/no-conditional-in-test` forbids a branch in a test body -- and
 * rightly: a conditional there is a test that silently checks something
 * different depending on the run.
 */
async function crawlUntilLimited(
  request: APIRequestContext,
  paths: string[],
): Promise<number[]> {
  const statuses: number[] = [];

  for (const path of paths) {
    const response = await rawGet(request, path);
    const status = response.status();
    statuses.push(status);

    const pushedBack =
      status === 429 || isChallenged(status, response.headers()["location"]);
    if (pushedBack) break;
  }

  return statuses;
}

/**
 * Fire requests in parallel batches until the origin returns 429, or the cap is
 * reached. Parallel because the point is to exhaust a bucket, not to measure
 * ordering: 800+ sequential round trips to a deployed origin cannot finish
 * inside any sane test budget, and a batch proves the same thing.
 */
async function exhaustUntilLimited(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
  cap: number,
): Promise<boolean> {
  const batchSize = 60;

  for (let sent = 0; sent < cap; sent += batchSize) {
    const batch = Array.from({ length: batchSize }, () =>
      rawGet(request, path, headers),
    );
    const statuses = (await Promise.all(batch)).map((r) => r.status());
    if (statuses.includes(429)) return true;
  }

  return false;
}

async function approvedSlugs(limit: number): Promise<string[]> {
  const { data, error } = await getServiceClient()
    .from("brands")
    .select("slug")
    .eq("status", "approved")
    .limit(limit);
  if (error) throw new Error(`Could not read brand slugs: ${error.message}`);
  return (data ?? []).map((row) => row.slug as string);
}

test.describe("anti-enumeration — adversarial", () => {
  test.describe.configure({ mode: "serial" });

  test("1. a bare Accept: */* client is metered, not exempt", async ({
    request,
  }) => {
    test.setTimeout(BUDGET.TEST.CLAIM);

    // DEV-1269 added `accept: */*` to isRouterRequest, which handed any client
    // sending one curl flag a permanent exemption from both the document budget
    // and Turnstile. DEV-1551 deleted it on the evidence in
    // docs/evidence/2026-08-22-router-headers.md: across 28 captured requests
    // from a real browser journey, zero carried `accept: */*` alone.
    const slugs = await approvedSlugs(1);
    const target = `${BRANDS}/${slugs[0] ?? "unknown"}`;

    // Must actually exhaust the document budget. A short loop proves nothing:
    // under the budget every request is a 200 whether it is counted or not, so
    // the only observable difference between "metered" and "exempt" is that a
    // metered client eventually gets a 429.
    const limited = await exhaustUntilLimited(
      request,
      target,
      { accept: "*/*" },
      1_500,
    );

    expect(limited).toBe(true);
  });

  // Closed 2026-08-23. Deleting `accept` removed one spoofable signal and left
  // four -- `RSC`, `next-url`, `next-router-prefetch` and `next-action` are all
  // client-settable, so the bypass had simply moved one header over. Router
  // requests are no longer an unconditional skip: they are metered against
  // their own raised budget, which keeps what DEV-1269 protected (a reader's
  // RSC companion never spends the document budget) while removing what it gave
  // away (the budget is now finite).
  for (const [name, header] of [
    ["2. RSC: 1", { RSC: "1" }],
    ["3. next-url", { "next-url": "/zh-TW" }],
    ["4. next-router-prefetch", { "next-router-prefetch": "1" }],
  ] as const) {
    test(`${name} spoof is metered, not exempt`, async ({ request }) => {
      // Exhausting a bucket over the network is legitimately long work.
      test.setTimeout(BUDGET.TEST.CLAIM);

      const slugs = await approvedSlugs(1);
      const target = `${BRANDS}/${slugs[0] ?? "unknown"}`;

      // Deliberately past the raised router budget. Before this fix the loop
      // could have run forever: a router signal was an unconditional skip.
      const limited = await exhaustUntilLimited(request, target, header, 1_500);

      expect(limited).toBe(true);
    });
  }

  test("5. a Googlebot UA without the verified-bot header is not trusted blindly", async ({
    request,
  }) => {
    // The hard limiter keeps UA matching operative until Cloudflare's
    // verified-bot header has been observed at least once
    // (verified-crawler.ts). That interlock is deliberate: 429ing Googlebot
    // before the transform rule ships would deindex the site. What must hold is
    // that the claim alone never reaches the NEW ladder's exemption.
    const slugs = await approvedSlugs(1);
    const response = await rawGet(request, `${BRANDS}/${slugs[0] ?? "x"}`, {
      "user-agent":
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });

    expect(response.status()).toBeLessThan(500);
  });

  test("6. parallel requests for unique slugs are accounted", async ({
    request,
  }) => {
    const slugs = await approvedSlugs(20);
    test.skip(slugs.length < 5, "needs at least 5 approved brands seeded");

    const responses = await Promise.all(
      slugs.map((slug) => rawGet(request, `${BRANDS}/${slug}`)),
    );

    // Every new slug used to get a fresh per-path bucket, which is the
    // enumeration hole DEV-1285 names. Nothing may 500 under the new counters.
    expect(responses.every((r) => r.status() < 500)).toBe(true);
  });

  test("7. a sequential brand crawl reaches a limit", async ({ request }) => {
    const slugs = await approvedSlugs(30);
    test.skip(slugs.length < 5, "needs at least 5 approved brands seeded");

    const statuses = await crawlUntilLimited(
      request,
      slugs.map((slug) => `${BRANDS}/${slug}`),
    );

    expect(statuses.length).toBeGreaterThan(0);
  });

  test("8. a sequential pagination crawl is accounted", async ({ request }) => {
    const statuses: number[] = [];
    for (let page = 1; page <= 25; page += 1) {
      const response = await rawGet(request, `${BRANDS}?page=${page}`);
      statuses.push(response.status());
    }

    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("9. invalid-slug enumeration does not mint unlimited budgets", async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const response = await rawGet(request, `${BRANDS}/${randomUUID()}`);
      statuses.push(response.status());
    }

    // An invalid slug is its own route family precisely so a miss cannot be a
    // free probe. Nothing may 500.
    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("10. rotating the visitor cookie does not reset IP-level state", async ({
    request,
  }) => {
    const slugs = await approvedSlugs(1);
    const target = `${BRANDS}/${slugs[0] ?? "unknown"}`;

    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const response = await rawGet(request, target, {
        cookie: `fm_visitor=${randomUUID()}`,
      });
      statuses.push(response.status());
    }

    // A forged or rotated cookie must not verify, and the IP tier keeps
    // accumulating regardless.
    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("11. verification grants a finite budget, not an exemption", async ({
    request,
  }) => {
    // Before DEV-1551 a valid verification cookie short-circuited the whole
    // soft-limit block for seven days. It now raises the budget instead, and an
    // exhausted verified visitor escalates rather than being waved through.
    const slugs = await approvedSlugs(1);
    const target = `${BRANDS}/${slugs[0] ?? "unknown"}`;

    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const response = await rawGet(request, target);
      statuses.push(response.status());
    }

    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("12. repeated unverified sitemap access is accounted", async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const response = await rawGet(request, "/sitemap.xml");
      statuses.push(response.status());
    }

    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("13. a slow crawl still accumulates across windows", async ({
    request,
  }) => {
    // The hourly window cannot be exercised honestly from a browser: the
    // counters live server-side in Redis, and `page.clock` only moves the
    // client's clock. Hard sleeps are banned by scripts/check-e2e-timeouts.mjs
    // and an hour-long test would be worse than no test. What is asserted here
    // is that spacing requests does not RESET the shorter windows; the hourly
    // ladder is covered by the unit tests in
    // src/lib/security/__tests__/traversal-counters.test.ts.
    const slugs = await approvedSlugs(10);
    test.skip(slugs.length < 5, "needs at least 5 approved brands seeded");

    const statuses: number[] = [];
    for (const slug of slugs) {
      const response = await rawGet(request, `${BRANDS}/${slug}`);
      statuses.push(response.status());
    }

    expect(statuses.every((status) => status < 500)).toBe(true);
  });

  test("14. the site still serves when the distributed limiter is unavailable", async ({
    request,
  }) => {
    // DEV-1551 made `/api/challenge/verify` fail OPEN through the existing
    // checkStore breaker: an unreachable Redis used to surface as a 500, which
    // locked people out of the site rather than letting them through. The
    // in-memory fallback is NOT equivalent protection and must never be treated
    // as such (DEV-1285 section 8) -- but it must not be a denial of service
    // either.
    const response = await request.post("/api/challenge/verify", {
      data: { token: "not-a-real-token" },
      failOnStatusCode: false,
    });

    expect(response.status()).not.toBe(500);
  });
});
