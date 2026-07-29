import { describe, expect, it, vi } from "vitest";
import { checkUrl, runLinkHealthCheck } from "./link-health";

const mocks = vi.hoisted(() => ({
  existingRow: null as Record<string, unknown> | null,
  upsertRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === "brands") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: "brand-1",
                  purchase_website: "https://recovered.example/",
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
            data: mocks.existingRow ? [mocks.existingRow] : [],
            error: null,
          }),
        }),
        upsert: async (rows: Record<string, unknown>[]) => {
          mocks.upsertRows.push(...rows);
          return { data: null, error: null };
        },
      };
    },
    rpc: async (name: string) => ({
      data: name === "claim_health_agent_run" ? { claimed: true } : true,
      error: null,
    }),
  }),
}));

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
});

describe("link health cleanup recovery", () => {
  it("clears the cleanup flag when a flagged link now returns ok", async () => {
    mocks.upsertRows.length = 0;
    mocks.existingRow = {
      id: "row-1",
      brand_id: "brand-1",
      field: "purchase_website",
      url: "https://recovered.example/",
      consecutive_failures: 3,
      failure_dates: ["2026-07-20", "2026-07-21", "2026-07-22"],
      last_ok_at: null,
      auto_nulled_at: null,
      cleanup_required_at: "2026-07-22T00:00:00.000Z",
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ status: 200 }) as unknown as typeof fetch;

    const summary = await runLinkHealthCheck({
      runIdentity: "cleanup-recovery-test",
      fetchFn,
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });

    expect(summary.cleanupRequired).toHaveLength(0);
    expect(mocks.upsertRows[0]).toMatchObject({
      brand_id: "brand-1",
      field: "purchase_website",
      cleanup_required: false,
      cleanup_required_at: null,
      failure_dates: [],
      consecutive_failures: 0,
    });
  });
});
