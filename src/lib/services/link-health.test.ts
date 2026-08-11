import { describe, expect, it, vi } from "vitest";
import {
  checkUrl,
  runLinkHealthCheck,
  type LinkHealthDatabaseClient,
} from "./link-health";

/**
 * Fake database boundary injected via `options.client`. The service is never
 * mocked at the module level — the test-boundary guard forbids that, and a
 * seam keeps the contract visible in the signature.
 */
function createFakeDb(options: {
  brandUrl: string;
  existingRow: Record<string, unknown> | null;
  upsertRows: Record<string, unknown>[];
}) {
  return {
    from(table: string) {
      if (table === "brands") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: "brand-1",
                  purchase_website: options.brandUrl,
                  purchase_pinkoi: null,
                  purchase_shopee: null,
                  hero_image_url: null,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => ({
          in: async () => ({
            data: options.existingRow ? [options.existingRow] : [],
            error: null,
          }),
        }),
        upsert: async (rows: Record<string, unknown>[]) => {
          options.upsertRows.push(...rows);
          return { data: null, error: null };
        },
      };
    },
    rpc: async (name: string) => ({
      data: name === "claim_health_agent_run" ? { claimed: true } : true,
      error: null,
    }),
  } as unknown as LinkHealthDatabaseClient;
}

describe("link health HTTP classification", () => {
  it.each([
    [200, "ok"],
    [301, "ok"],
    [403, "blocked"],
    [429, "blocked"],
    [404, "broken"],
    [410, "broken"],
    [500, "broken"],
  ] as const)(
    "classifies an HTTP %s response as %s",
    async (statusCode, status) => {
      const fetchBoundary = vi.fn().mockResolvedValue({ status: statusCode });

      await expect(
        checkUrl(
          "https://shop.mu-guang.tw/products/ceramic-cup",
          fetchBoundary,
        ),
      ).resolves.toEqual({ status, statusCode });
    },
  );

  it("returns broken when the network boundary fails", async () => {
    const fetchBoundary = vi
      .fn()
      .mockRejectedValue(new TypeError("connection failed"));

    await expect(
      checkUrl("https://shop.mu-guang.tw/products/ceramic-cup", fetchBoundary),
    ).resolves.toEqual({ status: "broken", statusCode: null });
  });

  it("retries a rejected HEAD method with GET", async () => {
    const fetchBoundary = vi
      .fn()
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      checkUrl("https://shop.mu-guang.tw/products/ceramic-cup", fetchBoundary),
    ).resolves.toEqual({ status: "ok", statusCode: 200 });
    expect(fetchBoundary.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });

  it("confirms a HEAD 404 with GET before calling the link broken", async () => {
    // A HEAD 404 used to be final. It is not evidence: SPA hosts and PHP front
    // controllers routinely route only GET and hand every HEAD to a 404
    // handler. Of the first nine links this fed to automatic removal, seven
    // answered HEAD 404 / GET 200 — aastalee.com, two myportfolio.com sites,
    // kaohsiungdiy.com, i-morona.com.tw, binguofarm.com.tw, qrc.afa.gov.tw.
    // Nulling them would have destroyed seven working purchase links.
    const fetchBoundary = vi
      .fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      checkUrl("https://aastalee.com/", fetchBoundary),
    ).resolves.toEqual({ status: "ok", statusCode: 200 });
    expect(fetchBoundary.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });

  it("still reports broken when GET confirms the 404", async () => {
    const fetchBoundary = vi
      .fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 404 });

    await expect(
      checkUrl("https://www.dearfig.com", fetchBoundary),
    ).resolves.toEqual({ status: "broken", statusCode: 404 });
  });

  it("confirms a HEAD 410 with GET as well", async () => {
    const fetchBoundary = vi
      .fn()
      .mockResolvedValueOnce({ status: 410 })
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      checkUrl("https://shop.mu-guang.tw/products/ceramic-cup", fetchBoundary),
    ).resolves.toEqual({ status: "ok", statusCode: 200 });
  });
});

describe("link health cleanup recovery", () => {
  it("clears the cleanup flag when a flagged link now returns ok", async () => {
    const upsertRows: Record<string, unknown>[] = [];
    const client = createFakeDb({
      brandUrl: "https://recovered.example/",
      upsertRows,
      existingRow: {
        id: "row-1",
        brand_id: "brand-1",
        field: "purchase_website",
        url: "https://recovered.example/",
        consecutive_failures: 3,
        failure_dates: ["2026-07-20", "2026-07-21", "2026-07-22"],
        last_ok_at: null,
        auto_nulled_at: null,
        cleanup_required_at: "2026-07-22T00:00:00.000Z",
      },
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ status: 200 }) as unknown as typeof fetch;

    const summary = await runLinkHealthCheck({
      runIdentity: "cleanup-recovery-test",
      client,
      fetchFn,
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });

    expect(summary.cleanupRequired).toHaveLength(0);
    expect(upsertRows[0]).toMatchObject({
      brand_id: "brand-1",
      field: "purchase_website",
      cleanup_required: false,
      cleanup_required_at: null,
      failure_dates: [],
      consecutive_failures: 0,
    });
  });
});

describe("link_check_results lookup batching", () => {
  // DEV-1381: PostgREST carries `.in()` values in the query string, so one
  // filter holding every approved brand id overflows the URL. Measured against
  // production 2026-08-07: 300 ids ok, 500 ids "TypeError: fetch failed", 718
  // ids "Bad Request". The health agent's nightly run had been failing on this
  // for weeks, surfacing only as an opaque HTTP 500 from /api/cron/link-health.
  // It is a scale bug — it began the moment the approved corpus grew past the
  // threshold, so a test that uses a handful of brands can never catch it.
  it("splits the brand-id filter into bounded chunks", async () => {
    const brandCount = 718;
    const brands = Array.from({ length: brandCount }, (_, index) => ({
      id: `brand-${index}`,
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      purchase_myship: null,
      hero_image_url: null,
    }));
    const inCallSizes: number[] = [];

    const client = {
      from(table: string) {
        if (table === "brands") {
          return {
            select: () => ({ eq: async () => ({ data: brands, error: null }) }),
          };
        }
        return {
          select: () => ({
            in: async (_column: string, values: string[]) => {
              inCallSizes.push(values.length);
              return { data: [], error: null };
            },
          }),
          upsert: async () => ({ data: null, error: null }),
        };
      },
      rpc: async () => ({ data: true, error: null }),
    } as unknown as LinkHealthDatabaseClient;

    await runLinkHealthCheck({
      dryRun: true,
      client,
      fetchFn: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });

    expect(inCallSizes.length).toBeGreaterThan(1);
    // Every chunk must stay under the URL ceiling; 300 was the largest size
    // observed working against production.
    expect(Math.max(...inCallSizes)).toBeLessThanOrEqual(300);
    // No id may be dropped by the batching.
    expect(inCallSizes.reduce((sum, size) => sum + size, 0)).toBe(brandCount);
  });
});
