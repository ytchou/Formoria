import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi
    .fn()
    .mockImplementation(
      (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
        fn({ summary: {} }),
    ),
}));

import { auditedCall } from "@/lib/audit";
import { systemStatus, brandContext, jobDetail } from "../readers";

// ---------------------------------------------------------------------------
// Test 9: readers_wrap_service_calls
// ---------------------------------------------------------------------------

describe("readers wrap service calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("systemStatus returns healthRuns, fixQueue, and jobs from injected deps", async () => {
    const deps = {
      client: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [{ id: "run-1" }], error: null }),
            }),
          }),
        }),
        rpc: vi.fn(),
      } as never,
      listCurationJobs: vi.fn().mockResolvedValue({ items: [{ id: "job-1" }] }),
    };

    // Mock `from` to handle both health_agent_run_ledger and health_fix_queue
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "health_agent_run_ledger") {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: "run-1" }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "health_fix_queue") {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ status: "pending", count: 3 }],
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn() };
    });
    deps.client = { from: mockFrom, rpc: vi.fn() } as never;

    const result = await systemStatus(deps);
    expect(result).toHaveProperty("healthRuns");
    expect(result).toHaveProperty("fixQueue");
    expect(result).toHaveProperty("jobs");
    expect(deps.listCurationJobs).toHaveBeenCalledOnce();
  });

  it("brandContext returns brand info for exact slug match", async () => {
    const mockBrand = { slug: "test-brand", name: "Test Brand" };
    const deps = {
      client: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "target-1" }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      } as never,
      searchBrandsAutocomplete: vi.fn().mockResolvedValue([]),
      getBrandBySlug: vi.fn().mockResolvedValue(mockBrand),
    };

    const result = await brandContext("test-brand", deps);
    expect(result).toHaveProperty("brand");
    expect(deps.getBrandBySlug).toHaveBeenCalledWith("test-brand");
  });

  it("brandContext returns search results for ambiguous query", async () => {
    const deps = {
      client: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      } as never,
      searchBrandsAutocomplete: vi.fn().mockResolvedValue([
        { slug: "brand-a", name: "Brand A" },
        { slug: "brand-b", name: "Brand B" },
      ]),
      getBrandBySlug: vi.fn().mockRejectedValue(new Error("not found")),
    };

    const result = await brandContext("brand", deps);
    expect(result).toHaveProperty("searchResults");
    expect(deps.searchBrandsAutocomplete).toHaveBeenCalledWith("brand");
  });

  it("jobDetail delegates to injected getCurationJobDetail", async () => {
    const mockDetail = { id: "job-1", status: "completed" };
    const deps = {
      getCurationJobDetail: vi.fn().mockResolvedValue(mockDetail),
    };

    const result = await jobDetail("job-1", deps);
    expect(result).toEqual(mockDetail);
    expect(deps.getCurationJobDetail).toHaveBeenCalledWith("job-1");
  });
});

// ---------------------------------------------------------------------------
// Test 10: every reader is wrapped in auditedCall
// ---------------------------------------------------------------------------

describe("every reader wraps in auditedCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("systemStatus wraps in auditedCall", async () => {
    const deps = {
      client: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      } as never,
      listCurationJobs: vi.fn().mockResolvedValue({ items: [] }),
    };

    await systemStatus(deps);
    expect(auditedCall).toHaveBeenCalled();
    const spec = vi.mocked(auditedCall).mock.calls[0]![0] as { provider: string };
    expect(spec.provider).toBe("ops-agent");
  });

  it("brandContext wraps in auditedCall", async () => {
    const deps = {
      client: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      } as never,
      searchBrandsAutocomplete: vi.fn().mockResolvedValue([]),
      getBrandBySlug: vi.fn().mockRejectedValue(new Error("not found")),
    };

    await brandContext("test", deps);
    expect(auditedCall).toHaveBeenCalled();
  });

  it("jobDetail wraps in auditedCall", async () => {
    const deps = {
      getCurationJobDetail: vi.fn().mockResolvedValue({ id: "j1" }),
    };

    await jobDetail("j1", deps);
    expect(auditedCall).toHaveBeenCalled();
  });
});
