import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createCohereRerankClient } from "../cohere-rerank-client";

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("cohere-rerank-client", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("rerank success reorders by relevance score", async () => {
    // Cohere returns results in arbitrary order; the client must sort descending.
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { index: 2, relevance_score: 0.3 },
          { index: 0, relevance_score: 0.95 },
          { index: 1, relevance_score: 0.7 },
        ],
      }),
    );

    const client = createCohereRerankClient("test-key");
    const result = await client.rerank("best coffee", [
      "espresso guide",
      "tea origins",
      "latte art",
    ]);

    expect(result.results).toEqual([
      { index: 0, relevanceScore: 0.95 },
      { index: 1, relevanceScore: 0.7 },
      { index: 2, relevanceScore: 0.3 },
    ]);

    // Verify the request payload sent to Cohere.
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(COHERE_RERANK_URL);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "rerank-v3.5",
      query: "best coffee",
      documents: ["espresso guide", "tea origins", "latte art"],
      top_n: 50,
      return_documents: false,
    });
    expect(
      (init.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer test-key");
  });

  test("rerank retries on 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ index: 0, relevance_score: 0.8 }],
        }),
      );
    globalThis.fetch = fetchMock;

    const client = createCohereRerankClient("test-key");
    const promise = client.rerank("query", ["doc"], 10);

    // Advance past the retry backoff sleep.
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await promise;
    expect(result.results).toEqual([{ index: 0, relevanceScore: 0.8 }]);
    // First call got 429, second succeeded.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rerank retries on 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ index: 0, relevance_score: 0.6 }],
        }),
      );
    globalThis.fetch = fetchMock;

    const client = createCohereRerankClient("test-key");
    const promise = client.rerank("query", ["doc"]);

    await vi.advanceTimersByTimeAsync(10_000);

    const result = await promise;
    expect(result.results).toEqual([{ index: 0, relevanceScore: 0.6 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rerank throws on 401 no retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "invalid api token" }), {
          status: 401,
        }),
      );
    globalThis.fetch = fetchMock;

    const client = createCohereRerankClient("bad-key");
    await expect(client.rerank("query", ["doc"])).rejects.toThrow(
      /Cohere rerank failed: 401/,
    );
    // 401 is terminal — no retry, exactly one call.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("rerank throws on malformed response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: "unexpected" }));

    const client = createCohereRerankClient("test-key");
    await expect(client.rerank("query", ["doc"])).rejects.toThrow(
      /malformed response/,
    );
  });
});
