import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { ExternalServiceError } from "@/lib/errors";
import { fetchOpenAICosts } from "../costs";

const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-29T21:05:00.000Z");
const DAY = 86_400;
const SEPT_1 = Date.UTC(2026, 8, 1) / 1000;

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
});

function bucket(dayIndex: number, values: Array<[number, string]>) {
  return {
    object: "bucket",
    start_time: SEPT_1 + dayIndex * DAY,
    end_time: SEPT_1 + (dayIndex + 1) * DAY,
    results: values.map(([value, currency]) => ({
      object: "organization.costs.result",
      amount: { value, currency },
      line_item: null,
      project_id: null,
    })),
  };
}

function page(data: unknown[], nextPage: string | null = null) {
  return Response.json({
    object: "page",
    data,
    has_more: nextPage !== null,
    next_page: nextPage,
  });
}

describe("fetchOpenAICosts", () => {
  it("sums USD amounts per daily bucket from a single page", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        page([bucket(0, [[1.5, "usd"], [0.25, "usd"]]), bucket(1, [])]),
      );

    const costs = await fetchOpenAICosts(
      { startTime: START, endTime: END },
      { fetchImpl, apiKey: "admin-key" },
    );

    expect(costs.totalUsd).toBeCloseTo(1.75);
    expect(costs.days).toEqual([
      {
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-02T00:00:00.000Z",
        usd: 1.75,
      },
      {
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        usd: 0,
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/v1/organization/costs");
    expect(parsed.searchParams.get("start_time")).toBe(String(SEPT_1));
    expect(parsed.searchParams.get("end_time")).toBe(
      String(Math.floor(END.getTime() / 1000)),
    );
    expect(parsed.searchParams.get("bucket_width")).toBe("1d");
    expect(parsed.searchParams.get("limit")).toBe("31");
    expect(parsed.searchParams.has("page")).toBe(false);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer admin-key",
    );
    expect(writes.some((write) => write.operation === "organization_costs")).toBe(
      true,
    );
  });

  it("follows next_page cursors across pages", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page([bucket(0, [[2, "usd"]])], "cursor-2"))
      .mockResolvedValueOnce(page([bucket(1, [[3, "usd"]])]));

    const costs = await fetchOpenAICosts(
      { startTime: START, endTime: END },
      { fetchImpl, apiKey: "admin-key" },
    );

    expect(costs.totalUsd).toBe(5);
    expect(costs.days).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(fetchImpl.mock.calls[1]![0] as string);
    expect(secondUrl.searchParams.get("page")).toBe("cursor-2");
  });

  it("does not add non-USD amounts to the dollar total", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(page([bucket(0, [[4, "usd"], [9, "eur"]])]));

    const costs = await fetchOpenAICosts(
      { startTime: START, endTime: END },
      { fetchImpl, apiKey: "admin-key" },
    );

    expect(costs.totalUsd).toBe(4);
  });

  it("maps a non-2xx response to ExternalServiceError without the raw body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { message: "Invalid admin key", type: "invalid_request_error" } },
        { status: 401 },
      ),
    );

    const failure = await fetchOpenAICosts(
      { startTime: START, endTime: END },
      { fetchImpl, apiKey: "admin-key" },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ExternalServiceError);
    expect(failure).toMatchObject({
      provider: "openai",
      operation: "organization_costs",
      httpStatus: 401,
      safeMessage: "Invalid admin key",
    });
  });

  it("rejects a malformed payload at the adapter boundary", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ object: "page", data: "nope" }));

    await expect(
      fetchOpenAICosts(
        { startTime: START, endTime: END },
        { fetchImpl, apiKey: "admin-key" },
      ),
    ).rejects.toThrow("OpenAI Costs API returned an invalid response");
  });

  it("stops instead of looping when a page reports more data without a cursor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        object: "page",
        data: [bucket(0, [[1, "usd"]])],
        has_more: true,
        next_page: null,
      }),
    );

    await expect(
      fetchOpenAICosts(
        { startTime: START, endTime: END },
        { fetchImpl, apiKey: "admin-key" },
      ),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a not-configured error without calling the API when the key is missing", async () => {
    vi.stubEnv("OPENAI_ADMIN_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchOpenAICosts({ startTime: START, endTime: END }, { fetchImpl }),
    ).rejects.toThrow("OPENAI_ADMIN_KEY is required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
