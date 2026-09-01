import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  runWithAuditContext,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { createAuditedOpenAIClient } from "./llm-audit";
import { brandTarget } from "./_shared/enrichment-target";

vi.mock("./llm-pricing", () => ({
  priceUsage: vi.fn().mockResolvedValue({
    promptTokens: 100,
    cachedPromptTokens: 0,
    completionTokens: 25,
    costUsd: 0.005,
  }),
  usageFromRawResponse: vi.fn().mockReturnValue(null),
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

});

describe("Langfuse generation integration", () => {
  it("creates a Langfuse generation on chat complete", async () => {
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

    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };
    const inserts: InsertedRow[] = [];

    await runWithAuditContext({ langfuseTrace }, () => {
      const client = createAuditedOpenAIClient(
        {
          target,
          phase: "descriptions",
          supabase: fakeSupabase(inserts),
        },
        { apiKey: "k" },
      );
      return client.chat({ system: "s", user: "u" });
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    expect(mockGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "openai/chat_completions",
        model: expect.any(String),
        usage: expect.objectContaining({
          promptTokens: 100,
          completionTokens: 25,
        }),
        metadata: expect.objectContaining({
          phase: "descriptions",
          ok: true,
        }),
      }),
    );
  });

  it("Langfuse error does not block production call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        ),
      ),
    );

    const langfuseTrace = {
      generation: vi.fn(() => {
        throw new Error("Langfuse SDK exploded");
      }),
    };
    const inserts: InsertedRow[] = [];

    const result = await runWithAuditContext({ langfuseTrace }, () => {
      const client = createAuditedOpenAIClient(
        {
          target,
          phase: "descriptions",
          supabase: fakeSupabase(inserts),
        },
        { apiKey: "k" },
      );
      return client.chat({ system: "s", user: "u" });
    });

    // The call completed successfully despite Langfuse throwing
    expect(result).toMatchObject({ ok: true });
  });
});
