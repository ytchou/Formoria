import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureAlert } from "@/lib/adapters/alerting/sentry";
import {
  _resetSchemaAlertLatches,
  insertAiCallResult,
  mergeDescriptionAuditResponse,
  retryAuditWrite,
  type AiCallInput,
} from "./ai-results";
import { brandTarget } from "./enrichment-target";

vi.mock("@/lib/adapters/alerting/sentry", () => ({
  captureAlert: vi.fn(() => true),
}));

describe("description audit results", () => {
  it("preserves the model response and adds validation outcomes for a rejected description", () => {
    const rawResponse = {
      provider: "deepseek",
      ok: true,
      status: 200,
      response: {
        choices: [
          { message: { content: '{"description_zh":"價格為 NT$999"}' } },
        ],
      },
      usage: { total_tokens: 180 },
    };
    const parsed = {
      description_zh: "價格為 NT$999",
      description_en: null,
    };
    const validationRejections = [
      {
        field: "description_zh",
        reasons: ["pricing_information"],
        warnings: [],
        attempt: 1,
      },
    ];

    expect(
      mergeDescriptionAuditResponse(rawResponse, parsed, validationRejections),
    ).toEqual({
      ...rawResponse,
      parsed,
      validationRejections,
    });
  });
});

describe("audit persistence", () => {
  // This catches a transient Supabase/network failure making a provider failure
  // disappear from the durable audit trail after only one insert attempt.
  it("retries a transient error and succeeds", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValueOnce({ code: "40001", message: "serialization failure" })
      .mockResolvedValueOnce(null);
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toBeNull();
    expect(write).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("gives up after three transient attempts and returns the last error", async () => {
    const error = { code: "40001", message: "serialization failure" };
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValue(error);
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toBe(error);
    expect(write).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("does not retry a terminal error", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValue({ code: "23514", message: "constraint violation" });
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toMatchObject({
      code: "23514",
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("still accepts an injected wait with the two-argument signature", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValueOnce({ code: "40001", message: "temporary" })
      .mockResolvedValue(null);
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await retryAuditWrite(write, wait);

    expect(wait).toHaveBeenCalledTimes(1);
    const [delay] = wait.mock.calls[0] ?? [];
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThan(1_000);
  });

  it("never throws when a write rejects", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockRejectedValue(new Error("connection dropped"));
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toMatchObject({
      message: "connection dropped",
    });
    expect(write).toHaveBeenCalledTimes(3);
  });
});

type InsertError = { code?: string; message: string };

/** Records every insert; the first `errors.length` inserts fail with those errors in turn. */
function fakeSupabase(inserts: Record<string, unknown>[], errors: InsertError[] = []) {
  const queue = [...errors];
  return {
    from(table: string) {
      if (table !== "brand_ai_results") throw new Error(`Unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: queue.shift() ?? null };
        },
      };
    },
  } as never;
}

const PGRST204_REQUEST = {
  code: "PGRST204",
  message:
    "Could not find the 'request' column of 'brand_ai_results' in the schema cache",
};
const PG_42703_REQUEST = {
  code: "42703",
  message: 'column "request" of relation "brand_ai_results" does not exist',
};

function callInput(
  supabase: AiCallInput["supabase"],
  extra: Partial<AiCallInput> = {},
): AiCallInput {
  return {
    target: brandTarget("00000000-0000-4000-8000-000000000001"),
    phase: "facts",
    model: "gpt-test",
    // No usage: pricing would otherwise read llm_model_prices.
    rawResponse: { provider: "openai", ok: true, status: 200 },
    input: { system: "s", user: "u" },
    latencyMs: 12,
    supabase,
    ...extra,
  };
}

describe("insertAiCallResult request column", () => {
  beforeEach(() => {
    _resetSchemaAlertLatches();
    vi.mocked(captureAlert).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes request into the request column", async () => {
    const inserts: Record<string, unknown>[] = [];
    const request = { v: 1, system: "s", user: "u", maxTokens: 100 };

    await insertAiCallResult(callInput(fakeSupabase(inserts), { request }));
    await insertAiCallResult(callInput(fakeSupabase(inserts)));

    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.request).toEqual(request);
    expect(inserts[1]?.request).toBeNull();
  });

  it("missing request column re-inserts without it", async () => {
    const inserts: Record<string, unknown>[] = [];

    await insertAiCallResult(
      callInput(fakeSupabase(inserts, [PGRST204_REQUEST]), {
        request: { v: 1 },
      }),
    );

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toHaveProperty("request");
    expect(inserts[1]).not.toHaveProperty("request");
    for (const column of [
      "cost_usd",
      "prompt_tokens",
      "cached_prompt_tokens",
      "completion_tokens",
    ]) {
      expect(inserts[1]).toHaveProperty(column);
    }
    expect(inserts[1]).toMatchObject({ phase: "facts", model: "gpt-test" });
  });

  it("same fallback for 42703 naming request", async () => {
    const inserts: Record<string, unknown>[] = [];

    await insertAiCallResult(
      callInput(fakeSupabase(inserts, [PG_42703_REQUEST]), {
        request: { v: 1 },
      }),
    );

    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("request");
    expect(inserts[1]).toHaveProperty("cost_usd");
  });

  it("missing request column alerts once naming the request migration", async () => {
    const inserts: Record<string, unknown>[] = [];

    await insertAiCallResult(
      callInput(fakeSupabase(inserts, [PGRST204_REQUEST]), { request: { v: 1 } }),
    );
    await insertAiCallResult(
      callInput(fakeSupabase(inserts, [PGRST204_REQUEST]), { request: { v: 1 } }),
    );

    expect(inserts).toHaveLength(4);
    expect(captureAlert).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(captureAlert).mock.calls[0] ?? [];
    expect(message).toContain("20261001100000_brand_ai_results_request.sql");
    expect(message).not.toContain("llm_cost_tracking");
    expect(options).toMatchObject({ level: "warning" });
  });

  it("42703 on another column keeps the cost-columns remediation", async () => {
    const inserts: Record<string, unknown>[] = [];

    await insertAiCallResult(
      callInput(
        fakeSupabase(inserts, [
          {
            code: "42703",
            message:
              'column "cost_usd" of relation "brand_ai_results" does not exist',
          },
        ]),
        { request: { v: 1 } },
      ),
    );

    expect(inserts).toHaveLength(1);
    expect(captureAlert).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(captureAlert).mock.calls[0] ?? [];
    expect(message).toContain("20260803023000_llm_cost_tracking.sql");
    expect(options).toMatchObject({ level: "error" });
  });

  it("eval sink path ignores request", async () => {
    const sinkDir = mkdtempSync(join(tmpdir(), "ai-results-sink-"));
    const sinkPath = join(sinkDir, "sink.jsonl");
    process.env.CURATION_EVAL_SINK = sinkPath;
    try {
      const inserts: Record<string, unknown>[] = [];

      await insertAiCallResult(
        callInput(fakeSupabase(inserts), { request: { v: 1, user: "u" } }),
      );

      expect(inserts).toHaveLength(0);
      const lines = readFileSync(sinkPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(record).not.toHaveProperty("request");
      expect(record).toMatchObject({ phase: "facts", model: "gpt-test" });
    } finally {
      delete process.env.CURATION_EVAL_SINK;
      rmSync(sinkDir, { recursive: true, force: true });
    }
  });
});
