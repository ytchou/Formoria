import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
} from "@/lib/constants/llm-models";
import { RETRY_ATTEMPTS } from "@/lib/retry";

describe("createOpenAIEmbeddingsClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("embeds a batch and returns vectors in input order with usage", async () => {
    const { createOpenAIEmbeddingsClient } = await import(
      "./openai-embeddings-client"
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0.2, 0.3] },
            { index: 0, embedding: [0.1, 0.4] },
          ],
          usage: { prompt_tokens: 10, total_tokens: 10 },
          model: EMBEDDING_MODEL,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = createOpenAIEmbeddingsClient({});
    const result = await client.embed(["hello", "world"]);

    expect(result.ok).toBe(true);
    expect(result.vectors).toEqual([
      [0.1, 0.4],
      [0.2, 0.3],
    ]);
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.model).toBe(EMBEDDING_MODEL);
  });

  it("throws before fetching when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const { createOpenAIEmbeddingsClient } = await import(
      "./openai-embeddings-client"
    );
    const client = createOpenAIEmbeddingsClient({ apiKey: "" });

    await expect(client.embed(["hello"])).rejects.toThrow(
      "OPENAI_API_KEY is not configured",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retries a 429 and gives up on insufficient_quota", async () => {
    const { createOpenAIEmbeddingsClient } = await import(
      "./openai-embeddings-client"
    );

    // insufficient_quota: should stop after 1 attempt (terminal).
    const insufficientQuotaResponse = () =>
      new Response(
        JSON.stringify({
          error: { code: "insufficient_quota", message: "You have exceeded your quota." },
        }),
        { status: 429 },
      );

    const fetchSpy = vi.fn().mockResolvedValue(insufficientQuotaResponse());
    globalThis.fetch = fetchSpy;

    const client = createOpenAIEmbeddingsClient({});
    await expect(client.embed(["hello"])).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Plain 429: should retry RETRY_ATTEMPTS times.
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Rate limited" } }),
        { status: 429 },
      ),
    );

    await expect(client.embed(["hello"])).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
  }, 30_000);

  it("rejects more than EMBEDDING_BATCH_SIZE inputs", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const { createOpenAIEmbeddingsClient } = await import(
      "./openai-embeddings-client"
    );
    const client = createOpenAIEmbeddingsClient({});
    const inputs = Array.from(
      { length: EMBEDDING_BATCH_SIZE + 1 },
      (_, i) => `text-${i}`,
    );

    await expect(client.embed(inputs)).rejects.toThrow(
      `Batch size ${EMBEDDING_BATCH_SIZE + 1} exceeds maximum ${EMBEDDING_BATCH_SIZE}`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
