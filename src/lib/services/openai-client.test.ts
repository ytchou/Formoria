import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIClient,
  isNonRetryableProviderError,
  type ChatAuditEvent,
  type ChatMessage,
  type ChatToolDefinition,
  type ChatUsage,
} from "./openai-client";
import { LLM_MODELS } from "@/lib/constants/llm-models";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Body of the nth fetch call, parsed. The client only ever sends JSON strings. */
function requestBody(
  spy: ReturnType<typeof vi.spyOn>,
  call = 0,
): Record<string, unknown> {
  const init = spy.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/** Drives a chat() call to completion through the rate-limit sleeps without waiting in real time. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = run();
  await vi.runAllTimersAsync();
  return promise;
}

function okResponse(content = "hi") {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

describe("createOpenAIClient", () => {
  it("fires onChatComplete with usage and latency on success", async () => {
    const usage: ChatUsage = {
      prompt_tokens: 21,
      completion_tokens: 8,
      total_tokens: 29,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
          usage,
        }),
      ),
    );
    const events: ChatAuditEvent[] = [];
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: (event) => {
        events.push(event);
      },
    });

    await client.chat({ system: "system prompt", user: "user prompt" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "openai",
      ok: true,
      usage: { total_tokens: 29 },
    });
    expect(events[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fires onChatComplete with data null on HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events: ChatAuditEvent[] = [];
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: (event) => {
        events.push(event);
      },
    });

    await client.chat({ system: "system prompt", user: "user prompt" });

    expect(events[0]).toMatchObject({
      provider: "openai",
      ok: false,
      data: null,
    });
  });

  it("includes the provider response payload in an HTTP failure audit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "server error" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events: ChatAuditEvent[] = [];
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: (event) => {
        events.push(event);
      },
    });

    await client.chat({ system: "system prompt", user: "user prompt" });

    expect(events[0]?.data).toEqual({ error: { message: "server error" } });
  });

  it("does not reject chat when the audit hook throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: () => {
        throw new Error("audit unavailable");
      },
    });

    await expect(
      client.chat({ system: "system prompt", user: "user prompt" }),
    ).resolves.toBeDefined();
  });

  it("onChatComplete still fires on success and on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse("success"))
      .mockResolvedValue(new Response(null, { status: 500 }));
    const events: ChatAuditEvent[] = [];
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: (event) => {
        events.push(event);
      },
    });

    await client.chat({ system: "s", user: "u" });
    await withFakeTimers(() => client.chat({ system: "s", user: "u" }));

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({ ok: false }),
      ]),
    );
  });

  it("hook errors never fail the LLM call", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const client = createOpenAIClient({
      apiKey: "k",
      onChatComplete: () => {
        throw new Error("audit unavailable");
      },
    });

    const result = await client.chat({ system: "s", user: "u" });

    expect(result.ok).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("ChatAuditEvent is imported from the audit module", () => {
    const openAiSource = readFileSync(
      resolve(process.cwd(), "src/lib/services/openai-client.ts"),
      "utf8",
    );
    const localDeclaration = `type ChatAudit${"Event"} = {`;

    expect(openAiSource).not.toContain(localDeclaration);
    expect(openAiSource).toContain('from "@/lib/audit"');
  });

  describe("request body", () => {
    it("sends max_completion_tokens and reasoning_effort for gpt-5 models, never max_tokens", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({
        apiKey: "k",
        model: LLM_MODELS.text,
      });

      await client.chat({
        system: "s",
        user: "u",
        maxTokens: 250,
        temperature: 0,
        reasoningEffort: "none",
      });

      const body = requestBody(fetchSpy);
      expect(body).toMatchObject({
        model: LLM_MODELS.text,
        max_completion_tokens: 250,
        reasoning_effort: "none",
        temperature: 0,
      });
      // gpt-5 rejects max_tokens outright — this is the assertion that catches the 400.
      expect(body).not.toHaveProperty("max_tokens");
    });

    // The regression that took every image classification down: the classifier
    // asks for a temperature and nothing else, so if the client does not supply
    // `reasoning_effort: 'none'` itself, gpt-5 rejects the temperature outright.
    it("turns reasoning off by itself when a gpt-5 caller asks only for a temperature", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({
        apiKey: "k",
        model: LLM_MODELS.text,
      });

      await client.chat({
        system: "s",
        user: "u",
        maxTokens: 250,
        temperature: 0.1,
      });

      expect(requestBody(fetchSpy)).toMatchObject({
        temperature: 0.1,
        reasoning_effort: "none",
      });
    });

    // Sampling is only live when reasoning is off, so the two cannot both apply.
    // An explicit effort wins and the temperature is dropped rather than sent,
    // because sending both is a 400 that fails the entire call.
    it("drops the temperature when a gpt-5 caller explicitly wants reasoning", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({
        apiKey: "k",
        model: LLM_MODELS.text,
      });

      await client.chat({
        system: "s",
        user: "u",
        temperature: 0.1,
        reasoningEffort: "high",
      });

      const body = requestBody(fetchSpy);
      expect(body).toMatchObject({ reasoning_effort: "high" });
      expect(body).not.toHaveProperty("temperature");
    });

    it("keeps max_tokens and omits reasoning_effort for non-gpt-5 models", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k", model: "gpt-4o-mini" });

      await client.chat({
        system: "s",
        user: "u",
        maxTokens: 250,
        temperature: 0,
        reasoningEffort: "none",
      });

      const body = requestBody(fetchSpy);
      expect(body).toMatchObject({
        model: "gpt-4o-mini",
        max_tokens: 250,
        temperature: 0,
      });
      expect(body).not.toHaveProperty("max_completion_tokens");
      expect(body).not.toHaveProperty("reasoning_effort");
    });

    it("omits reasoning_effort when the caller does not ask for one", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({
        apiKey: "k",
        model: LLM_MODELS.text,
      });

      await client.chat({ system: "s", user: "u" });

      expect(requestBody(fetchSpy)).not.toHaveProperty("reasoning_effort");
    });
  });

  describe("rate limiting", () => {
    // This catches the production failure where a transient thrown fetch became
    // HTTP 0 and abandoned an entire image batch without a recovery attempt.
    it("recovers from a transient network failure and audits both attempts", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValue(okResponse("recovered"));
      const events: ChatAuditEvent[] = [];
      const client = createOpenAIClient({
        apiKey: "k",
        onChatComplete: (event) => {
          events.push(event);
        },
      });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(result.content).toBe("recovered");
      expect(
        events.map(({ ok, status, error }) => ({ ok, status, error })),
      ).toEqual([
        { ok: false, status: 0, error: "fetch failed" },
        { ok: true, status: 200, error: undefined },
      ]);
    });

    it("retries a 429 with backoff and returns the eventual success", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValue(okResponse("recovered"));
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(true);
      expect(result.content).toBe("recovered");
    });

    it("honours Retry-After before retrying", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(Math, "random").mockReturnValue(0);
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { "retry-after": "2" } }),
        )
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      vi.useFakeTimers();
      const promise = client.chat({ system: "s", user: "u" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await promise;

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("gives up after the retry cap and returns the 429 to the caller", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 429 }));
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(429);
    });

    it("retries a network failure twice", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValue(new TypeError("fetch failed"));
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
    });

    it("emits one audit event per attempt", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValue(okResponse("recovered"));
      const events: ChatAuditEvent[] = [];
      const client = createOpenAIClient({
        apiKey: "k",
        onChatComplete: (event) => {
          events.push(event);
        },
      });

      await withFakeTimers(() => client.chat({ system: "s", user: "u" }));

      expect(events).toHaveLength(3);
      expect(events.map((event) => event.retryAttempt)).toEqual([0, 1, 2]);
    });

    it("does not retry a 429 carrying insufficient_quota", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      // Quota exhaustion wears the same 429 as congestion but never recovers.
      // On 2026-08-02 that cost 5 doomed retries and ~31s of backoff on every
      // call of a 400-brand run.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "You exceeded your current quota",
              code: "insufficient_quota",
              type: "insufficient_quota",
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      );
      const client = createOpenAIClient({ apiKey: "k" });

      const timerSpy = vi.spyOn(globalThis, "setTimeout");
      const result = await client.chat({ system: "s", user: "u" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(429);
      // Exactly one timer: the single attempt's request deadline. A backoff
      // sleep would add a second one — that is the ~31s this saves per call.
      expect(timerSpy).toHaveBeenCalledTimes(1);
    });

    it("still retries a plain 429 that carries no quota code", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "Rate limit reached", type: "rate_limit_error" },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.status).toBe(429);
    });
  });

  describe("isNonRetryableProviderError", () => {
    it("matches insufficient_quota on either code or type", () => {
      expect(
        isNonRetryableProviderError({
          errorBody: { error: { code: "insufficient_quota" } },
        }),
      ).toBe(true);
      expect(
        isNonRetryableProviderError({
          errorBody: { error: { type: "insufficient_quota" } },
        }),
      ).toBe(true);
    });

    it("does not match ordinary rate limiting or a missing body", () => {
      expect(
        isNonRetryableProviderError({
          errorBody: { error: { type: "rate_limit_error" } },
        }),
      ).toBe(false);
      expect(isNonRetryableProviderError({ errorBody: null })).toBe(false);
      expect(isNonRetryableProviderError({ errorBody: "boom" })).toBe(false);
    });
  });

  describe("structured outputs fallback", () => {
    const schema = {
      name: "verdicts",
      schema: { type: "object", properties: {} },
    };

    it("retries with json_object when the model rejects json_schema", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "Invalid response_format",
                param: "response_format",
              },
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          ),
        )
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await client.chat({ system: "s", user: "u", schema });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(requestBody(fetchSpy, 0).response_format).toMatchObject({
        type: "json_schema",
      });
      expect(requestBody(fetchSpy, 1).response_format).toEqual({
        type: "json_object",
      });
      expect(result.ok).toBe(true);
    });

    it("does not retry a failure unrelated to response_format", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "context length exceeded" } }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await client.chat({ system: "s", user: "u", schema });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
    });

    it("re-runs the retry ladder for the schema fallback", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { message: "Invalid response_format", param: "response_format" },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValue(new Response(null, { status: 429 }));
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await withFakeTimers(() =>
        client.chat({ system: "s", user: "u", schema }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(6);
      expect(result.status).toBe(429);
    });
  });

  // Agent turns (DEV-1700) send a whole conversation and a tool list instead of
  // one system/user pair. The legacy shape is normalized into the same message
  // array, so there is still exactly one request builder.
  describe("messages and tools", () => {
    const conversation: ChatMessage[] = [
      { role: "system", content: "you plan" },
      { role: "user", content: "find the shop" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "fetch_url", arguments: '{"url":"https://a.tw"}' },
          },
        ],
      },
      { role: "tool", content: '{"ok":true}', tool_call_id: "call_1" },
    ];

    const tool: ChatToolDefinition = {
      name: "fetch_url",
      description: "Fetch a page",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
    };

    function toolCallResponse(argumentsJson: string) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_9",
                    type: "function",
                    function: { name: "fetch_url", arguments: argumentsJson },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
    }

    it("chat_with_messages_sends_the_array_verbatim", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      await client.chat({ messages: conversation });

      const body = requestBody(fetchSpy);
      expect(body.messages).toEqual(conversation);
      expect(body).not.toHaveProperty("response_format");
    });

    it("chat_with_tools_sends_function_definitions_and_no_response_format", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      await client.chat({ messages: conversation, tools: [tool] });

      const body = requestBody(fetchSpy);
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        },
      ]);
      expect(body).not.toHaveProperty("response_format");
    });

    it("chat_rejects_json_or_schema_together_with_tools", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      await expect(
        client.chat({ messages: conversation, tools: [tool], json: true }),
      ).rejects.toThrow(/tools cannot be combined/);
      await expect(
        client.chat({
          messages: conversation,
          tools: [tool],
          schema: { name: "s", schema: { type: "object" } },
        }),
      ).rejects.toThrow(/tools cannot be combined/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("chat_rejects_input_without_messages_or_system_user", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const client = createOpenAIClient({ apiKey: "k" });

      await expect(client.chat({ user: "u" })).rejects.toThrow(
        /messages or system/,
      );
      await expect(
        client.chat({ messages: conversation, system: "s", user: "u" }),
      ).rejects.toThrow(/messages or system/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("chat_parses_tool_calls_into_toolCalls", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        toolCallResponse('{"url":"https://a.tw"}'),
      );
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await client.chat({
        messages: conversation,
        tools: [tool],
      });

      expect(result.toolCalls).toEqual([
        { id: "call_9", name: "fetch_url", args: { url: "https://a.tw" } },
      ]);
      expect(result.content).toBeNull();
      expect(result.finishReason).toBe("tool_calls");
    });

    it("chat_keeps_raw_arguments_when_tool_call_json_is_invalid", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        toolCallResponse("{not json"),
      );
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await client.chat({
        messages: conversation,
        tools: [tool],
      });

      expect(result.toolCalls).toEqual([
        {
          id: "call_9",
          name: "fetch_url",
          args: {},
          rawArguments: "{not json",
        },
      ]);
    });

    it("chat_does_not_retry_after_the_caller_signal_aborts", async () => {
      // A thrown fetch is normally retried as a network failure; an aborted
      // caller signal must end the call on the first attempt instead of
      // sleeping through the whole backoff ladder.
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(
          Object.assign(new Error("This operation was aborted"), {
            name: "AbortError",
          }),
        );
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const controller = new AbortController();
      controller.abort();
      const client = createOpenAIClient({ apiKey: "k" });

      const result = await client.chat({
        messages: conversation,
        signal: controller.signal,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
    });

    it("chat_legacy_system_user_input_is_unchanged", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());
      const events: ChatAuditEvent[] = [];
      const client = createOpenAIClient({
        apiKey: "k",
        onChatComplete: (event) => {
          events.push(event);
        },
      });

      await client.chat({ system: "s", user: "u" });
      const plain = requestBody(fetchSpy, 0);
      expect(plain.messages).toEqual([
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ]);
      expect(plain).not.toHaveProperty("response_format");
      expect(plain).not.toHaveProperty("tools");

      await client.chat({ system: "s", user: "u", json: true });
      expect(requestBody(fetchSpy, 1).response_format).toEqual({
        type: "json_object",
      });

      expect(events[0]?.request).toEqual({
        system: "s",
        user: "u",
        imageCount: 0,
      });
      expect(events[0]?.meta).toBeUndefined();
    });

    it("chat_audit_event_for_messages_carries_first_system_first_user_and_counts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
      const events: ChatAuditEvent[] = [];
      const client = createOpenAIClient({
        apiKey: "k",
        onChatComplete: (event) => {
          events.push(event);
        },
      });

      await client.chat({
        messages: conversation,
        tools: [tool],
        meta: { phase: "acquire" },
      });

      expect(events[0]?.request).toEqual({
        system: "you plan",
        user: "find the shop",
        imageCount: 0,
      });
      expect(events[0]?.meta).toEqual({
        phase: "acquire",
        messageCount: conversation.length,
        toolCallCount: 1,
      });
    });
  });
});
