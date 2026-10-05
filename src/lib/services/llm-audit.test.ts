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
import { priceUsage } from "./llm-pricing";
import type { ChatMessage } from "./openai-client";

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

  it("records prompt and completion tokens even when pricing fails", async () => {
    vi.mocked(priceUsage).mockRejectedValueOnce(new Error("price lookup down"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            usage: { prompt_tokens: 40, completion_tokens: 7 },
          }),
          { status: 200 },
        ),
      ),
    );

    const client = createAuditedOpenAIClient(
      { target, phase: "descriptions", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes[1]).toMatchObject({
      status: "succeeded",
      promptTokens: 40,
      completionTokens: 7,
    });
    expect(writes[1]?.costUsd ?? null).toBeNull();
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

describe("NUL characters in the logged request", () => {
  it("strips U+0000 from request and input so jsonb accepts the row", async () => {
    const inserts: InsertedRow[] = [];
    const head = "a".repeat(2_500);
    const user = `${head}\u0000tail`;
    const client = createAuditedOpenAIClient(
      { target, phase: "descriptions", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    await client.chat({
      system: "s\u0000ys",
      user,
      meta: { note: ["x\u0000y"] },
    });

    const row = inserts[0]!;
    expect(JSON.stringify(row.request)).not.toContain("\\u0000");
    expect(JSON.stringify(row.input)).not.toContain("\\u0000");
    expect(row.request).toMatchObject({
      v: 1,
      system: "sys",
      user: `${head}tail`,
      meta: { note: ["xy"] },
    });
    expect(row.input).toMatchObject({ system: "sys", user: `${head}tail` });
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
    // Langfuse generation input is the full request.
    expect(inserts[0]?.request).toEqual({ v: 1, system: "s", user: "u" });
    expect(mockGeneration.mock.calls[0]![0].input).toEqual(inserts[0]?.request);
  });

  it("Langfuse input above the cap is cut visibly", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };
    const inserts: InsertedRow[] = [];
    const hugeUser = "u".repeat(1_000_001);

    await runWithAuditContext({ langfuseTrace }, () => {
      const client = createAuditedOpenAIClient(
        { target, phase: "descriptions", supabase: fakeSupabase(inserts) },
        { apiKey: "k" },
      );
      return client.chat({ system: "s", user: hugeUser });
    });

    expect(mockGeneration).toHaveBeenCalledOnce();
    const body = mockGeneration.mock.calls[0]![0];
    expect(body.input).toEqual({ system: "s", user: `${"u".repeat(2_000)}…` });
    expect(body.metadata).toMatchObject({
      inputTruncated: true,
      inputBytes: Buffer.byteLength(JSON.stringify(inserts[0]?.request), "utf8"),
      auditSpanId: inserts[0]?.audit_span_id,
    });
    // The DB row keeps the full request regardless of the trace cap.
    expect((inserts[0]?.request as { user: string }).user).toHaveLength(
      1_000_001,
    );
  });

  it("Langfuse input under the char count but over the byte cap is cut visibly", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };
    const inserts: InsertedRow[] = [];
    // 400,000 chars, but 1.2 MB of UTF-8: CJK is three bytes per char.
    const cjkUser = "字".repeat(400_000);

    await runWithAuditContext({ langfuseTrace }, () => {
      const client = createAuditedOpenAIClient(
        { target, phase: "descriptions", supabase: fakeSupabase(inserts) },
        { apiKey: "k" },
      );
      return client.chat({ system: "s", user: cjkUser });
    });

    const serialized = JSON.stringify(inserts[0]?.request);
    expect(serialized.length).toBeLessThan(1_000_000);
    const body = mockGeneration.mock.calls[0]![0];
    expect(body.input).toEqual({ system: "s", user: `${"字".repeat(2_000)}…` });
    expect(body.metadata).toMatchObject({
      inputTruncated: true,
      inputBytes: Buffer.byteLength(serialized, "utf8"),
      auditSpanId: inserts[0]?.audit_span_id,
    });
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

  it("sends uncut system and user when no request is supplied", async () => {
    const mockGeneration = vi.fn();
    const langfuseTrace = { generation: mockGeneration };
    const longUser = "u".repeat(5_000);

    await runWithAuditContext({ langfuseTrace }, () => {
      emitLangfuseGeneration({ phase: "detect" }, {
        ...baseEvent,
        request: { system: "sys", user: longUser, imageCount: 0 },
      });
      return Promise.resolve();
    });

    const body = mockGeneration.mock.calls[0]![0];
    expect(body.input).toEqual({ system: "sys", user: longUser });
    expect(body.metadata).not.toHaveProperty("inputTruncated");
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

  it("capture carries the call's paramFallback, absent when none applied (DEV-1917)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "Unsupported parameter: 'max_tokens'",
                type: "invalid_request_error",
                param: "max_tokens",
                code: "unsupported_parameter",
              },
            }),
            { status: 400 },
          ),
        )
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
              { status: 200 },
            ),
          ),
        ),
    );
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    // A model name no other test teaches a parameter shape to.
    const client = createAuditedOpenAIClient(
      { phase: "facts" },
      { apiKey: "k", model: "gpt-4o-mini-dev-1917-capture" },
    );

    await client.chat({ system: "s", user: "u", maxTokens: 50 });

    expect(captured).toHaveLength(2);
    expect(captured[0]).not.toHaveProperty("paramFallback");
    expect(captured[1]!.paramFallback).toEqual([
      "max_tokens->max_completion_tokens",
    ]);
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
  });

  it("capture copies the caller's messages array", async () => {
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
    ];
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );

    await client.chat({ messages });
    messages.push({ role: "user", content: "later turn" });

    expect(captured[0]!.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
    ]);
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

type ChatInput = Parameters<
  ReturnType<typeof createAuditedOpenAIClient>["chat"]
>[0];

// Compile-time key list: adding a ChatInput field fails typecheck here until
// the test (and the builder's own list) account for it.
const CHAT_INPUT_KEYS = {
  system: true,
  user: true,
  messages: true,
  tools: true,
  signal: true,
  json: true,
  timeoutMs: true,
  maxTokens: true,
  temperature: true,
  reasoningEffort: true,
  images: true,
  imageDetail: true,
  meta: true,
  schema: true,
} satisfies Record<keyof ChatInput, true>;

describe("full request logging", () => {
  beforeEach(() => {
    // A fresh body per call: several tests here make two calls.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
            { status: 200 },
          ),
      ),
    );
  });

  const schema = {
    name: "facts",
    schema: { type: "object", properties: { a: { type: "string" } } },
  };

  it("stores the full logical request for a legacy call", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );
    const user = "u".repeat(5_000);
    const controller = new AbortController();

    await client.chat({
      system: "sys",
      user,
      json: true,
      schema,
      maxTokens: 512,
      temperature: 0.2,
      reasoningEffort: "none",
      meta: { promptVersion: 3 },
      signal: controller.signal,
    });

    expect(inserts).toHaveLength(1);
    const request = inserts[0]?.request as Record<string, unknown>;
    expect(request).toEqual({
      v: 1,
      system: "sys",
      user,
      json: true,
      schema,
      maxTokens: 512,
      temperature: 0.2,
      reasoningEffort: "none",
      meta: { promptVersion: 3 },
    });
    expect((request.user as string).length).toBe(5_000);
    expect(request).not.toHaveProperty("signal");
  });

  it("stores messages and tools for an agent call", async () => {
    let releaseFetch: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
          { status: 200 },
        );
      }),
    );
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "acquire", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );
    const messages: ChatMessage[] = [
      { role: "system", content: "you plan" },
      { role: "user", content: "find the shop" },
    ];
    const tools = [
      {
        name: "fetch_url",
        description: "Fetch a page",
        parameters: { type: "object", properties: {} },
      },
    ];

    const pending = client.chat({ messages, tools });
    messages.push({ role: "user", content: "later turn" });
    releaseFetch();
    await pending;

    const request = inserts[0]?.request as Record<string, unknown>;
    expect(request.messages).toEqual([
      { role: "system", content: "you plan" },
      { role: "user", content: "find the shop" },
    ]);
    expect(request.tools).toEqual(tools);
    expect(request).not.toHaveProperty("system");
    expect(request).not.toHaveProperty("user");
  });

  it("never stores a data URI", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "classify-images", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    await client.chat({
      system: "sys",
      user: "u",
      images: ["data:image/webp;base64,AAAA"],
      meta: { imageUrls: ["https://x/1.webp"] },
    });
    await client.chat({
      messages: [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,BBBB", detail: "low" },
            },
            {
              type: "image_url",
              image_url: { url: "https://x/2.webp", detail: "low" },
            },
          ],
        },
      ],
    });

    expect(inserts).toHaveLength(2);
    expect((inserts[0]?.request as { images: unknown }).images).toEqual([
      "https://x/1.webp",
    ]);
    const messages = (inserts[1]?.request as { messages: ChatMessage[] })
      .messages;
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "look" },
      { omitted: "data-uri" },
      {
        type: "image_url",
        image_url: { url: "https://x/2.webp", detail: "low" },
      },
    ]);
    for (const row of inserts) {
      expect(JSON.stringify(row.request)).not.toContain("data:image");
    }
  });

  it("image count mismatch uses placeholders", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "classify-images", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    await client.chat({
      system: "sys",
      user: "u",
      images: ["data:image/webp;base64,AAAA", { url: "data:image/webp;base64,CCCC" }],
      meta: { imageUrls: ["https://x/1.webp"] },
    });

    expect((inserts[0]?.request as { images: unknown }).images).toEqual([
      { omitted: "data-uri" },
      { omitted: "data-uri" },
    ]);
    expect(JSON.stringify(inserts[0]?.request)).not.toContain("data:image");
  });

  it('buildLoggedRequest replaces a data URI with the placeholder when the matching imageUrl is ""', async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "classify-images", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    await client.chat({
      system: "sys",
      user: "u",
      images: ["data:image/webp;base64,AAAA", "data:image/webp;base64,BBBB"],
      meta: { imageUrls: ["", "https://x/2.webp"] },
    });

    expect((inserts[0]?.request as { images: unknown }).images).toEqual([
      { omitted: "data-uri" },
      "https://x/2.webp",
    ]);
  });

  it("buildLoggedRequest replaces a data URI with the placeholder when the matching imageUrl is not http(s)", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "classify-images", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );

    await client.chat({
      system: "sys",
      user: "u",
      images: ["data:image/webp;base64,AAAA"],
      meta: { imageUrls: ["submissions/x.webp"] },
    });

    expect((inserts[0]?.request as { images: unknown }).images).toEqual([
      { omitted: "data-uri" },
    ]);
  });

  it("request builder exhaustive over ChatInput keys", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );
    const controller = new AbortController();

    // messages and tools exclude system/user and json/schema, so two fully
    // populated calls together cover every key.
    await client.chat({
      system: "sys",
      user: "u",
      json: true,
      schema,
      timeoutMs: 10_000,
      maxTokens: 100,
      temperature: 0,
      reasoningEffort: "low",
      images: ["https://x/1.webp"],
      imageDetail: "high",
      meta: { imageUrls: ["https://x/1.webp"] },
      signal: controller.signal,
    });
    await client.chat({
      messages: [{ role: "user", content: "u" }],
      tools: [{ name: "t", description: "d", parameters: {} }],
      signal: controller.signal,
    });

    const storedKeys = new Set(
      inserts.flatMap((row) => Object.keys(row.request as object)),
    );
    for (const key of Object.keys(CHAT_INPUT_KEYS)) {
      if (key === "signal") {
        expect(storedKeys.has(key)).toBe(false);
      } else {
        expect(storedKeys.has(key), key).toBe(true);
      }
    }
  });

  it("input.system/user are stored uncut", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );
    const longUser = "u".repeat(5_000);

    await client.chat({ system: "sys", user: longUser });

    const input = inserts[0]?.input as { system: string; user: string };
    expect(input.user).toHaveLength(5_000);
    expect(input.user).toBe(longUser);
    expect(input.system).toBe("sys");
  });

  it("builder failure never fails the call", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      { target, phase: "facts", supabase: fakeSupabase(inserts) },
      { apiKey: "k" },
    );
    // Throws on the builder's read only; the client's own read succeeds, so
    // the failure is isolated to request logging.
    let metaReads = 0;
    const input = {
      system: "sys",
      user: "u",
      get meta() {
        metaReads += 1;
        if (metaReads === 1) throw new Error("meta exploded");
        return { a: 1 };
      },
    };

    const result = await client.chat(input);

    expect(result).toMatchObject({ ok: true, content: "answer" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.request).toBeNull();
  });

  it("capture seam still receives raw messages", async () => {
    const captured: CapturedCall[] = [];
    setChatCaptureSeam((call) => captured.push(call));
    const client = createAuditedOpenAIClient(
      { target, phase: "acquire", supabase: fakeSupabase([]) },
      { apiKey: "k" },
    );
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,BBBB", detail: "low" },
          },
        ],
      },
    ];

    await client.chat({ messages });

    expect(captured[0]!.messages).toEqual(messages);
  });
});
