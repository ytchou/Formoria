import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { createAuditedDeepSeekClient, createAuditedOpenAIClient } from "./llm-audit";
import { brandTarget } from "./_shared/enrichment-target";

vi.mock("./llm-pricing", () => ({
  priceUsage: vi.fn().mockResolvedValue({
    promptTokens: 100,
    cachedPromptTokens: 0,
    completionTokens: 25,
    costUsd: 0.005,
  }),
}));

type InsertedRow = Record<string, unknown>;

function fakeSupabase(inserts: InsertedRow[]) {
  return {
    from(table: string) {
      if (table !== "brand_ai_results") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        insert: async (row: InsertedRow) => {
          inserts.push(row);
          return { error: null };
        },
      };
    },
  } as never;
}

const target = brandTarget("00000000-0000-4000-8000-000000000001");

let writes: AuditRecord[];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
        { status: 200 },
      ),
    ),
  );
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllGlobals();
});

describe("audited LLM clients", () => {
  it("an audited LLM call writes a span linked to its brand_ai_results row", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "descriptions",
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes).toHaveLength(2);
    expect(writes[0]?.status).toBe("started");
    expect(writes[1]?.status).toBe("succeeded");
    expect(writes[0]?.spanId).toBe(writes[1]?.spanId);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.audit_span_id).toBe(writes[0]?.spanId);
    expect(inserts[0]).toMatchObject({
      brand_id: target.id,
      raw_response: {
        provider: "openai",
        ok: true,
        status: 200,
      },
    });
    expect(inserts[0]?.prompt_tokens).toBeNull();
  });

  it("onChatComplete bridges usage to audit context for OpenAI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            usage: { prompt_tokens: 100, completion_tokens: 25 },
          }),
          { status: 200 },
        ),
      ),
    );

    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "descriptions",
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      status: "succeeded",
      promptTokens: 100,
      completionTokens: 25,
      costUsd: 0.005,
    });
  });

  it("onChatComplete bridges usage to audit context for DeepSeek", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            usage: { prompt_tokens: 100, completion_tokens: 25 },
          }),
          { status: 200 },
        ),
      ),
    );

    const inserts: InsertedRow[] = [];
    const client = createAuditedDeepSeekClient(
      {
        target,
        phase: "reputation",
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      status: "succeeded",
      promptTokens: 100,
      completionTokens: 25,
      costUsd: 0.005,
    });
  });

  it("audits a DeepSeek balance call", async () => {
    const client = createAuditedDeepSeekClient(
      {
        target,
        phase: "reputation",
      },
      { apiKey: "k" },
    );

    await client.balance();

    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      provider: "deepseek",
      operation: "balance",
      status: "started",
      summary: { phase: "reputation", targetType: "brand" },
    });
    expect(writes[1]).toMatchObject({
      provider: "deepseek",
      operation: "balance",
      status: "succeeded",
    });
  });
});
