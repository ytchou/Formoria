import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  runWithAuditContext,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import {
  createAuditedOpenAIClient,
  createProfiledOpenAIClient,
  emitLangfuseGeneration,
  setChatCaptureSeam,
  type CapturedCall,
  type LlmAuditContext,
} from "./llm-audit";
import { brandTarget } from "./_shared/enrichment-target";
import { buildEnrichmentConfig } from "@/lib/constants/enrichment-config";

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
  setChatCaptureSeam(null);
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

  it("records cached and cache-write tokens from usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 25,
              prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const client = createAuditedOpenAIClient(
      { target, phase: "descriptions", supabase: fakeSupabase([]) },
      { apiKey: "k", model: "gpt-6-luna" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes[1]).toMatchObject({
      status: "succeeded",
      cachedPromptTokens: 20,
      cacheWriteTokens: 5,
      model: "gpt-6-luna",
    });
  });

  // Agent turns go through the same hook: a tool-call response must land in
  // brand_ai_results with its tool_calls payload, not an empty content row.
  it("audited_client_writes_a_row_for_a_tool_turn", async () => {
    const toolCalls = [
      {
        id: "call_1",
        type: "function",
        function: { name: "fetch_url", arguments: '{"url":"https://a.tw"}' },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: null, tool_calls: toolCalls },
                finish_reason: "tool_calls",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "acquire",
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    const result = await client.chat({
      messages: [
        { role: "system", content: "you plan" },
        { role: "user", content: "find the shop" },
      ],
      tools: [
        {
          name: "fetch_url",
          description: "Fetch a page",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "fetch_url", args: { url: "https://a.tw" } },
    ]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.input).toMatchObject({
      system: "you plan",
      user: "find the shop",
      meta: { messageCount: 2, toolCallCount: 1 },
    });
    expect(inserts[0]?.raw_response).toMatchObject({
      response: { choices: [{ message: { tool_calls: toolCalls } }] },
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
        costDetails: { total: 0.005 },
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

describe("emitLangfuseGeneration — prompt and cost fields", () => {
  const baseEvent = {
    provider: "openai" as const,
    model: "gpt-4o",
    ok: true,
    status: 200,
    data: "answer",
    latencyMs: 42,
    request: { system: "sys", user: "usr", imageCount: 0 },
    usage: { prompt_tokens: 100, completion_tokens: 25 },
  };

  it("forwards promptName and promptVersion regardless of source", async () => {
    // Test with source: 'langfuse'
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = {
        phase: "detect",
        prompt: { name: "detect-prompt", version: 3, source: "langfuse" },
      };
      emitLangfuseGeneration(ctx, baseEvent);
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    let body = mockGeneration.mock.calls[0]![0];
    expect(body.promptName).toBe("detect-prompt");
    expect(body.promptVersion).toBe(3);

    // Test with source: 'snapshot'
    mockGeneration.mockClear();

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = {
        phase: "detect",
        prompt: { name: "detect-prompt", version: 5, source: "snapshot" },
      };
      emitLangfuseGeneration(ctx, baseEvent);
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    body = mockGeneration.mock.calls[0]![0];
    expect(body.promptName).toBe("detect-prompt");
    expect(body.promptVersion).toBe(5);
  });

  it("omits prompt fields when context.prompt is absent", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = { phase: "detect" };
      emitLangfuseGeneration(ctx, baseEvent);
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    const body = mockGeneration.mock.calls[0]![0];
    expect(body).not.toHaveProperty("promptName");
    expect(body).not.toHaveProperty("promptVersion");
  });

  it("includes costUsd when supplied", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = { phase: "detect" };
      emitLangfuseGeneration(ctx, baseEvent, 0.0123);
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    const body = mockGeneration.mock.calls[0]![0];
    expect(body.costDetails).toEqual({ total: 0.0123 });
  });

  it("langfuse_generation_metadata_carries_response_format", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = { phase: "detect" };
      emitLangfuseGeneration(ctx, {
        ...baseEvent,
        meta: { responseFormat: "json_schema" },
      });
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    const body = mockGeneration.mock.calls[0]![0];
    expect(body.metadata).toMatchObject({ responseFormat: "json_schema" });
  });

  it("langfuse_generation_metadata_omits_response_format_when_absent", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };

    await runWithAuditContext({ langfuseTrace }, () => {
      const ctx: LlmAuditContext = { phase: "detect" };
      emitLangfuseGeneration(ctx, baseEvent);
      return Promise.resolve();
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    const body = mockGeneration.mock.calls[0]![0];
    expect(body.metadata).not.toHaveProperty("responseFormat");
  });
});

describe("buildEnrichmentConfig", () => {
  it("has no promptHash and version v2.4", () => {
    const config = buildEnrichmentConfig("detect", { model: "gpt-4o" });
    expect(Object.keys(config).sort()).toEqual(["params", "phase", "version"]);
    expect(config.version).toBe("v2.4");
  });
});

describe("persistAuditEvent — config.prompt merge", () => {
  it("writes config.prompt when context has both config and prompt", async () => {
    const inserts: Record<string, unknown>[] = [];
    const config = buildEnrichmentConfig("detect", { model: "gpt-4o" });
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "detect",
        config,
        prompt: { name: "detect", version: 3, source: "langfuse" as const },
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.config).toEqual({
      ...config,
      prompt: { name: "detect", version: 3, source: "langfuse" },
    });
  });

  it("writes prompt without config", async () => {
    const inserts: Record<string, unknown>[] = [];
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "detect",
        prompt: { name: "detect", version: 3, source: "langfuse" as const },
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.config).toEqual({
      prompt: { name: "detect", version: 3, source: "langfuse" },
    });
  });

  it("leaves config untouched when context.prompt is absent", async () => {
    const inserts: Record<string, unknown>[] = [];
    const config = buildEnrichmentConfig("detect", { model: "gpt-4o" });
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "detect",
        config,
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.config).toEqual(config);
    expect(inserts[0]!.config).not.toHaveProperty("prompt");
  });
});

describe("chat capture seam", () => {
  it("capture seam receives untruncated system and user", async () => {
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    const longUser = "u".repeat(5_000);
    const client = createProfiledOpenAIClient(
      "facts",
      {
        target,
        phase: "facts",
        prompt: { name: "facts-prompt", version: 2, source: "langfuse" },
        supabase: fakeSupabase([]),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "sys", user: longUser });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      phase: "facts",
      profileKey: "facts",
      system: "sys",
      user: longUser,
      promptName: "facts-prompt",
    });
    expect(captured[0]!.user).toHaveLength(5_000);
  });

  it("capture records the full request and the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
          { status: 200 },
        ),
      ),
    );
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    const longUser = "x".repeat(2_500);
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );

    await client.chat({ system: "sys", user: longUser, json: true });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: longUser },
    ]);
    const userMessage = captured[0]!.messages[1] as { content: string };
    expect(userMessage.content).toHaveLength(2_500);
    expect(captured[0]!.response).toEqual({
      content: '{"ok":true}',
      parsed: { ok: true },
    });
    expect(captured[0]!.schema).toBeUndefined();
  });

  it("capture records the request schema so an agreement replay can re-send it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
          { status: 200 },
        ),
      ),
    );
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    const schema = { name: "facts", schema: { type: "object", properties: {}, additionalProperties: false } };
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );

    await client.chat({ system: "sys", user: "u", schema });

    expect(captured[0]!.schema).toEqual(schema);
  });

  it("capture stays zero-write", async () => {
    // Capture runs under installSeams, which sets CURATION_EVAL_SINK; the
    // injected Supabase client is the seam that would see a brand_ai_results write.
    const sinkDir = mkdtempSync(join(tmpdir(), "llm-audit-capture-"));
    process.env.CURATION_EVAL_SINK = join(sinkDir, "sink.jsonl");
    try {
      const captured: CapturedCall[] = [];
      setChatCaptureSeam((call) => captured.push(call));
      const inserts: InsertedRow[] = [];
      const client = createAuditedOpenAIClient(
        { target, phase: "facts", supabase: fakeSupabase(inserts) },
        { apiKey: "k" },
      );

      await client.chat({ system: "sys", user: "u" });

      expect(captured).toHaveLength(1);
      expect(captured[0]!.response.content).toBe("answer");
      expect(inserts).toHaveLength(0);
    } finally {
      delete process.env.CURATION_EVAL_SINK;
      rmSync(sinkDir, { recursive: true, force: true });
    }
  });

  it("capture seam errors never fail the call", async () => {
    setChatCaptureSeam(() => {
      throw new Error("seam exploded");
    });
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "descriptions", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    const result = await client.chat({ system: "s", user: "u" });

    expect(result).toMatchObject({ ok: true });
    expect(inserts).toHaveLength(1);
  });

  it("setChatCaptureSeam(null) stops capture", async () => {
    const seam = vi.fn();
    setChatCaptureSeam(seam);
    setChatCaptureSeam(null);
    const client = createAuditedOpenAIClient(
      { target, phase: "descriptions", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(seam).not.toHaveBeenCalled();
  });
});
