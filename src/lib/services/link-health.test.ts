import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/server";
import {
  checkUrl,
  RUN_LEDGER_RPC_NAMES,
  runLinkHealthCheck,
  type LinkHealthSummary,
} from "./link-health";

type BrandRow = {
  id: string;
  purchase_website: string | null;
  purchase_pinkoi: string | null;
  purchase_shopee: string | null;
  hero_image_url: string | null;
};

type LinkCheckRow = {
  id: string;
  brand_id: string;
  field: string;
  url: string;
  consecutive_failures: number;
  last_ok_at: string | null;
  auto_nulled_at: string | null;
  failure_dates?: string[];
  cleanup_required_at?: string | null;
};

type RpcResponse = { data: unknown; error: { message: string } | null };

function makeSupabaseMock(
  brands: BrandRow[],
  existingRows: LinkCheckRow[] = [],
) {
  const brandsSelectEq = vi
    .fn()
    .mockResolvedValue({ data: brands, error: null });
  const brandsUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const brandsUpdateFn = vi.fn().mockReturnValue({ eq: brandsUpdateEq });

  const linkSelectIn = vi
    .fn()
    .mockResolvedValue({ data: existingRows, error: null });
  const linkSelectFn = vi.fn().mockReturnValue({ in: linkSelectIn });
  const linkUpsertFn = vi.fn().mockResolvedValue({ error: null });
  const linkDeleteIn = vi.fn().mockResolvedValue({ error: null });
  const linkDeleteFn = vi.fn().mockReturnValue({ in: linkDeleteIn });

  const brandsMock = {
    select: vi.fn().mockReturnValue({ eq: brandsSelectEq }),
    update: brandsUpdateFn,
  };
  const linkCheckMock = {
    select: linkSelectFn,
    upsert: linkUpsertFn,
    delete: linkDeleteFn,
  };

  const rpcFn = vi
    .fn()
    .mockImplementation(async (name: string): Promise<RpcResponse> => {
      if (name === RUN_LEDGER_RPC_NAMES.claim) {
        return {
          data: { claimed: true, run: { status: "claimed" } },
          error: null,
        };
      }
      return { data: true, error: null };
    });

  const client = {
    from: vi.fn((table: string) => {
      if (table === "brands") return brandsMock;
      if (table === "link_check_results") return linkCheckMock;
      return {};
    }),
    rpc: rpcFn,
  };

  return {
    client,
    spies: {
      brandsSelectEq,
      brandsUpdateFn,
      linkUpsertFn,
      linkDeleteIn,
      rpcFn,
    },
  };
}

const FIXED_NOW = new Date("2026-07-22T00:30:00.000Z");
const fixedClock = () => new Date(FIXED_NOW);

const okFetch: typeof fetch = () =>
  Promise.resolve({ status: 200, ok: true } as unknown as Response);

function runLive(
  fetchFn: typeof fetch = okFetch,
  overrides: Partial<Parameters<typeof runLinkHealthCheck>[0]> = {},
) {
  return runLinkHealthCheck({
    fetchFn,
    now: fixedClock,
    runIdentity: "github-link-health:2026-07-22",
    workflowAttempt: 1,
    ...overrides,
  });
}

describe("checkUrl", () => {
  it("returns ok for 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const result = await checkUrl("https://example.com", mockFetch);

    expect(result).toEqual({ status: "ok", statusCode: 200 });
  });

  it("returns ok for 301 redirect", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 301, ok: false });
    const result = await checkUrl("https://example.com", mockFetch);

    expect(result).toEqual({ status: "ok", statusCode: 301 });
  });

  it("returns broken for deterministic missing resources", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 404, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "broken",
      statusCode: 404,
    });
  });

  it("returns broken for 410 and 500", async () => {
    const goneFetch = vi.fn().mockResolvedValue({ status: 410, ok: false });
    const failedFetch = vi.fn().mockResolvedValue({ status: 500, ok: false });

    await expect(
      checkUrl("https://example.com", goneFetch),
    ).resolves.toMatchObject({
      status: "broken",
    });
    await expect(
      checkUrl("https://example.com", failedFetch),
    ).resolves.toMatchObject({
      status: "broken",
    });
  });

  it("returns broken on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "broken",
      statusCode: null,
    });
  });

  it("returns blocked for 429 from HEAD without a GET retry", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 429, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "blocked",
      statusCode: 429,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("retries 405 with GET and returns ok when GET succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 405, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "ok",
      statusCode: 200,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "GET" });
  });

  it.each([403, 429])("returns blocked when GET returns %s", async (status) => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 405, ok: false })
      .mockResolvedValueOnce({ status, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "blocked",
      statusCode: status,
    });
  });

  it("treats a HEAD 403 followed by a GET network error as blocked", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockRejectedValueOnce(new TypeError("network error"));

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "blocked",
      statusCode: 403,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not let a GET 404 override a blocked HEAD 403", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockResolvedValueOnce({ status: 404, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "blocked",
      statusCode: 403,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("keeps the HEAD 403 as the blocked evidence when GET is non-authoritative", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockResolvedValueOnce({ status: 500, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "blocked",
      statusCode: 403,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns broken for a non-blocking GET failure", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 501, ok: false })
      .mockResolvedValueOnce({ status: 500, ok: false });

    await expect(checkUrl("https://example.com", mockFetch)).resolves.toEqual({
      status: "broken",
      statusCode: 500,
    });
  });
});

describe("runLinkHealthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://xkcayngbttpxyibgzern.supabase.co",
    );
  });

  it("requires a stable run identity for live runs", async () => {
    const { client, spies } = makeSupabaseMock([], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await expect(
      runLinkHealthCheck({ now: fixedClock, fetchFn: okFetch }),
    ).rejects.toThrow("runIdentity is required for live link health checks");
    expect(spies.rpcFn).not.toHaveBeenCalled();
  });

  it("queries approved brands only", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await runLive();

    expect(spies.brandsSelectEq).toHaveBeenCalledWith("status", "approved");
  });

  it("increments failure telemetry once for a broken URL and records the Taipei date", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://example.com",
      consecutive_failures: 1,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: [],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const brokenFetch = vi
      .fn()
      .mockResolvedValue({ status: 500, ok: false } as Response);

    const result = await runLive(brokenFetch);

    const rows = spies.linkUpsertFn.mock.calls[0][0] as Array<{
      consecutive_failures: number;
      failure_dates: string[];
    }>;
    expect(rows[0]).toMatchObject({
      consecutive_failures: 2,
      failure_dates: ["2026-07-22"],
    });
    expect(result.broken).toBe(1);
  });

  it("retains distinct failure dates across an intervening successful check", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://example.com",
      consecutive_failures: 2,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: ["2026-07-20", "2026-07-21"],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await runLive();
    const row = (
      spies.linkUpsertFn.mock.calls[0][0] as Array<{
        consecutive_failures: number;
        failure_dates: string[];
      }>
    )[0];

    expect(row).toMatchObject({
      consecutive_failures: 0,
      failure_dates: ["2026-07-20", "2026-07-21"],
    });
  });

  it("does not increment or escalate blocked 403/429 checks", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://shop.example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://shop.example.com",
      consecutive_failures: 2,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: ["2026-07-20", "2026-07-21"],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const blockedFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, ok: false } as Response)
      .mockResolvedValueOnce({ status: 429, ok: false } as Response);

    const result = await runLive(blockedFetch);
    const rows = spies.linkUpsertFn.mock.calls[0][0] as Array<{
      consecutive_failures: number;
      failure_dates: string[];
      cleanup_required_at: string | null;
    }>;

    expect(rows[0]).toMatchObject({
      consecutive_failures: 2,
      failure_dates: ["2026-07-20", "2026-07-21"],
      cleanup_required_at: null,
    });
    expect(result).toMatchObject({
      blocked: 1,
      broken: 0,
      cleanupRequired: [],
    });
    expect(blockedFetch).toHaveBeenCalledOnce();
    expect(result.failingRows).toHaveLength(0);
  });

  it("requires cleanup after three distinct Taipei failure dates without writing brands", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://example.com",
      consecutive_failures: 2,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: ["2026-07-20", "2026-07-21"],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const brokenFetch = vi
      .fn()
      .mockResolvedValue({ status: 500, ok: false } as Response);

    const result = await runLive(brokenFetch);
    const rows = spies.linkUpsertFn.mock.calls[0][0] as Array<{
      cleanup_required_at: string | null;
      failure_dates: string[];
    }>;

    expect(rows[0]).toMatchObject({
      failure_dates: ["2026-07-20", "2026-07-21", "2026-07-22"],
      cleanup_required_at: FIXED_NOW.toISOString(),
    });
    expect(rows[0]).not.toHaveProperty("auto_nulled_at");
    expect(result.cleanupRequired).toEqual([
      { brandId: "b1", field: "purchase_website", url: "https://example.com" },
    ]);
    expect(spies.brandsUpdateFn).not.toHaveBeenCalled();
    expect(spies.linkDeleteIn).not.toHaveBeenCalled();
  });

  it("requires cleanup immediately for internal Supabase Storage 404/410", async () => {
    const url =
      "https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/missing.jpg";
    const brand: BrandRow = {
      id: "b1",
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: url,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const missingFetch = vi
      .fn()
      .mockResolvedValue({ status: 404, ok: false } as Response);

    const result = await runLive(missingFetch);
    const rows = spies.linkUpsertFn.mock.calls[0][0] as Array<{
      cleanup_required_at: string | null;
    }>;

    expect(rows[0].cleanup_required_at).toBe(FIXED_NOW.toISOString());
    expect(result.cleanupRequired).toEqual([
      { brandId: "b1", field: "hero_image_url", url },
    ]);
  });

  it("writes migration-consistent failure counts and cleanup flags for every telemetry row", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://website.example.com",
      purchase_pinkoi: "https://pinkoi.example.com",
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existingRows: LinkCheckRow[] = [
      {
        id: "r1",
        brand_id: "b1",
        field: "purchase_website",
        url: "https://website.example.com",
        consecutive_failures: 2,
        last_ok_at: null,
        auto_nulled_at: "2026-07-20T00:00:00.000Z",
        failure_dates: ["2026-07-20", "2026-07-21"],
        cleanup_required_at: null,
      },
      {
        id: "r2",
        brand_id: "b1",
        field: "purchase_pinkoi",
        url: "https://pinkoi.example.com",
        consecutive_failures: 0,
        last_ok_at: null,
        auto_nulled_at: null,
        failure_dates: [],
        cleanup_required_at: null,
      },
    ];
    const { client, spies } = makeSupabaseMock([brand], existingRows);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await runLive(
      vi.fn().mockResolvedValue({ status: 500, ok: false } as Response),
    );
    const rows = spies.linkUpsertFn.mock.calls[0][0] as Array<{
      failure_dates: string[];
      distinct_failure_days: number;
      cleanup_required: boolean;
      cleanup_required_at: string | null;
    }>;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.distinct_failure_days).toBe(row.failure_dates.length);
      expect(row.cleanup_required).toBe(row.cleanup_required_at !== null);
      expect(row).not.toHaveProperty("auto_nulled_at");
    }
  });

  it("preserves historical auto_nulled_at while remaining telemetry-only", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const historicalStamp = "2026-07-20T00:00:00.000Z";
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://example.com",
      consecutive_failures: 3,
      last_ok_at: null,
      auto_nulled_at: historicalStamp,
      failure_dates: ["2026-07-20", "2026-07-21", "2026-07-22"],
      cleanup_required_at: "2026-07-22T00:00:00.000Z",
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const result = await runLive();
    const row = (
      spies.linkUpsertFn.mock.calls[0][0] as Record<string, unknown>[]
    )[0];

    expect(row).not.toHaveProperty("auto_nulled_at");
    expect(result).not.toHaveProperty("autoNulled");
    expect(result.cleanupRequired).toEqual([
      { brandId: "b1", field: "purchase_website", url: "https://example.com" },
    ]);
    expect(spies.brandsUpdateFn).not.toHaveBeenCalled();
  });

  it("does not delete or update stale telemetry rows", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://old.example.com",
      consecutive_failures: 1,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: ["2026-07-20"],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await runLive();

    expect(spies.linkDeleteIn).not.toHaveBeenCalled();
    expect(spies.brandsUpdateFn).not.toHaveBeenCalled();
    expect(spies.linkUpsertFn).not.toHaveBeenCalled();
  });

  it("resets failure evidence when the URL changes but preserves historical auto_nulled_at", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://new.example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://old.example.com",
      consecutive_failures: 2,
      last_ok_at: "2026-07-21T00:00:00.000Z",
      auto_nulled_at: "2026-07-21T00:00:00.000Z",
      failure_dates: ["2026-07-20", "2026-07-21"],
      cleanup_required_at: "2026-07-21T00:00:00.000Z",
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const brokenFetch = vi
      .fn()
      .mockResolvedValue({ status: 500, ok: false } as Response);

    await runLive(brokenFetch);
    const row = (
      spies.linkUpsertFn.mock.calls[0][0] as Array<{
        consecutive_failures: number;
        failure_dates: string[];
        cleanup_required_at: string | null;
      }>
    )[0];

    expect(row).toMatchObject({
      consecutive_failures: 1,
      failure_dates: ["2026-07-22"],
      cleanup_required_at: null,
    });
    expect(row).not.toHaveProperty("auto_nulled_at");
  });

  it("replays a same-day completed run without checking or writing telemetry", async () => {
    const replaySummary: LinkHealthSummary = {
      checked: 1,
      ok: 1,
      broken: 0,
      blocked: 0,
      cleanupRequired: [],
      heroBroken: [],
      heroExternal: [],
      failingRows: [],
      severity: "ok",
    };
    const { client, spies } = makeSupabaseMock([], []);
    spies.rpcFn.mockImplementation(
      async (name: string): Promise<RpcResponse> => {
        if (name === RUN_LEDGER_RPC_NAMES.claim) {
          return {
            data: {
              claimed: false,
              replay: true,
              result: replaySummary,
              run: { status: "completed" },
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    );
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const fetchFn = vi.fn();

    const result = await runLive(fetchFn);

    expect(result).toEqual(replaySummary);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(spies.linkUpsertFn).not.toHaveBeenCalled();
    expect(spies.rpcFn).toHaveBeenCalledOnce();
  });

  it("rejects an active same-day claim without reading or writing telemetry", async () => {
    const { client, spies } = makeSupabaseMock([], []);
    spies.rpcFn.mockResolvedValueOnce({
      data: {
        claimed: false,
        replay: false,
        run: { status: "claimed" },
      },
      error: null,
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const fetchFn = vi.fn();

    await expect(runLive(fetchFn)).rejects.toThrow("already in progress");

    expect(fetchFn).not.toHaveBeenCalled();
    expect(spies.brandsSelectEq).not.toHaveBeenCalled();
    expect(spies.linkUpsertFn).not.toHaveBeenCalled();
    expect(spies.rpcFn).toHaveBeenCalledOnce();
  });

  it("completes a live run after telemetry persistence", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await runLive();

    expect(spies.rpcFn).toHaveBeenNthCalledWith(
      1,
      RUN_LEDGER_RPC_NAMES.claim,
      expect.objectContaining({
        p_requested_run_id: "github-link-health:2026-07-22",
        p_logical_date: "2026-07-22",
        p_workflow_attempt: 1,
        p_dry_run: false,
      }),
    );
    expect(spies.rpcFn).toHaveBeenLastCalledWith(
      RUN_LEDGER_RPC_NAMES.complete,
      expect.objectContaining({
        p_requested_run_id: "github-link-health:2026-07-22",
      }),
    );
    expect(spies.rpcFn.mock.calls[1]?.[1]).not.toHaveProperty("p_dry_run");
  });

  it("surfaces telemetry errors and records a failed live run", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    spies.linkUpsertFn.mockResolvedValue({
      error: { message: "telemetry unavailable" },
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await expect(runLive()).rejects.toThrow(
      "Failed to upsert link_check_results",
    );
    expect(spies.rpcFn).toHaveBeenLastCalledWith(
      RUN_LEDGER_RPC_NAMES.fail,
      expect.objectContaining({
        p_requested_run_id: "github-link-health:2026-07-22",
        p_result: null,
      }),
    );
    expect(spies.rpcFn.mock.calls.at(-1)?.[1]).not.toHaveProperty("p_dry_run");
  });

  it("surfaces run completion persistence errors and attempts the failure transition", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    spies.rpcFn.mockImplementation(
      async (name: string): Promise<RpcResponse> => {
        if (name === RUN_LEDGER_RPC_NAMES.claim) {
          return {
            data: { claimed: true, run: { status: "claimed" } },
            error: null,
          };
        }
        if (name === RUN_LEDGER_RPC_NAMES.complete) {
          return { data: null, error: { message: "completion unavailable" } };
        }
        return { data: true, error: null };
      },
    );
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await expect(runLive()).rejects.toThrow("completion unavailable");
    expect(spies.rpcFn).toHaveBeenLastCalledWith(
      RUN_LEDGER_RPC_NAMES.fail,
      expect.objectContaining({
        p_requested_run_id: "github-link-health:2026-07-22",
      }),
    );
  });

  it("surfaces failure-transition persistence errors instead of swallowing them", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    spies.linkUpsertFn.mockResolvedValue({
      error: { message: "telemetry unavailable" },
    });
    spies.rpcFn.mockImplementation(
      async (name: string): Promise<RpcResponse> => {
        if (name === RUN_LEDGER_RPC_NAMES.claim) {
          return {
            data: { claimed: true, run: { status: "claimed" } },
            error: null,
          };
        }
        if (name === RUN_LEDGER_RPC_NAMES.fail) {
          return {
            data: null,
            error: { message: "failure transition unavailable" },
          };
        }
        return { data: true, error: null };
      },
    );
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    await expect(runLive()).rejects.toThrow(
      "Link health failed and its ledger failure could not be persisted",
    );
  });

  it("performs no telemetry or ledger writes during a dry run", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const existing: LinkCheckRow = {
      id: "r1",
      brand_id: "b1",
      field: "purchase_website",
      url: "https://example.com",
      consecutive_failures: 1,
      last_ok_at: null,
      auto_nulled_at: null,
      failure_dates: ["2026-07-21"],
      cleanup_required_at: null,
    };
    const { client, spies } = makeSupabaseMock([brand], [existing]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ status: 500, ok: false } as Response);

    const result = await runLinkHealthCheck({
      dryRun: true,
      fetchFn,
      now: fixedClock,
    });

    expect(result.broken).toBe(1);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(spies.rpcFn).not.toHaveBeenCalled();
    expect(spies.linkUpsertFn).not.toHaveBeenCalled();
    expect(spies.linkDeleteIn).not.toHaveBeenCalled();
    expect(spies.brandsUpdateFn).not.toHaveBeenCalled();
  });

  it("does not call Agent Hub or any second fetch for reporting", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client } = makeSupabaseMock([brand], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ status: 200, ok: true } as Response);

    await runLive(fetchFn);

    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns ok without telemetry upsert when no URLs are present", async () => {
    const brand: BrandRow = {
      id: "b1",
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      hero_image_url: null,
    };
    const { client, spies } = makeSupabaseMock([brand], []);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const result = await runLive();

    expect(result).toMatchObject({ checked: 0, severity: "ok" });
    expect(spies.linkUpsertFn).not.toHaveBeenCalled();
  });
});
