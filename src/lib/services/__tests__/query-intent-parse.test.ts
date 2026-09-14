import { describe, expect, it, vi } from "vitest";
import {
  shouldAttemptIntentParse,
  parseQueryIntent,
  type IntentParseResult,
} from "../query-intent-parse";
import type { IntentParseCache } from "@/lib/cache/intent-parse-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockChat(response: { ok: boolean; content: string | null }) {
  return { chat: vi.fn().mockResolvedValue(response) };
}

function mockCache(
  store: Map<string, string> = new Map(),
): IntentParseCache & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(async (query: string) => store.get(query) ?? null),
    set: vi.fn(async (query: string, json: string) => {
      store.set(query, json);
    }),
  };
}

// ---------------------------------------------------------------------------
// shouldAttemptIntentParse
// ---------------------------------------------------------------------------

describe("shouldAttemptIntentParse", () => {
  it("returns true for a situation query with >= 6 CJK chars", () => {
    // 露營要帶的杯子 = 7 CJK chars
    expect(shouldAttemptIntentParse("露營要帶的杯子")).toBe(true);
  });

  it("returns false for a short keyword with < 6 CJK chars", () => {
    // 杯子 = 2 CJK chars
    expect(shouldAttemptIntentParse("杯子")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(shouldAttemptIntentParse("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseQueryIntent
// ---------------------------------------------------------------------------

describe("parseQueryIntent", () => {
  const VALID_RESPONSE: IntentParseResult = {
    category: "outdoor",
    subcategory: "hiking-and-camping-gear",
    materials: [],
  };

  it("extracts category from a well-formed LLM response", async () => {
    const chat = mockChat({
      ok: true,
      content: JSON.stringify(VALID_RESPONSE),
    });
    const cache = mockCache();

    const result = await parseQueryIntent("露營要帶什麼杯子", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.parsed.category).toBe("outdoor");
    expect(result!.cacheHit).toBe(false);
  });

  it("returns null when LLM hallucinates an invalid category", async () => {
    const chat = mockChat({
      ok: true,
      content: JSON.stringify({
        category: "nonexistent-category",
        subcategory: null,
        materials: [],
      }),
    });
    const cache = mockCache();

    const result = await parseQueryIntent("想買什麼東西來露營", {
      client: chat,
      cache,
    });

    expect(result).toBeNull();
  });

  it("nulls subcategory that does not belong to extracted category", async () => {
    const chat = mockChat({
      ok: true,
      content: JSON.stringify({
        // earrings belongs to jewelry, not outdoor
        category: "outdoor",
        subcategory: "earrings",
        materials: [],
      }),
    });
    const cache = mockCache();

    const result = await parseQueryIntent("露營要帶什麼東西出門", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.parsed.category).toBe("outdoor");
    expect(result!.parsed.subcategory).toBeNull();
  });

  it("returns null on AbortError (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const chat = { chat: vi.fn().mockRejectedValue(abortError) };
    const cache = mockCache();

    const result = await parseQueryIntent("露營要帶什麼杯子呢", {
      client: chat,
      cache,
    });

    expect(result).toBeNull();
  });

  it("returns null when LLM returns ok: false", async () => {
    const chat = mockChat({ ok: false, content: null });
    const cache = mockCache();

    const result = await parseQueryIntent("露營要帶什麼杯子呢", {
      client: chat,
      cache,
    });

    expect(result).toBeNull();
  });

  it("checks cache first and skips LLM on cache hit", async () => {
    const cached = JSON.stringify(VALID_RESPONSE);
    const store = new Map<string, string>();
    // Pre-populate: the cache stores by raw query
    store.set("露營要帶什麼杯子", cached);
    const cache = mockCache(store);
    const chat = mockChat({ ok: true, content: "should not be called" });

    const result = await parseQueryIntent("露營要帶什麼杯子", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.cacheHit).toBe(true);
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it("writes to cache on successful parse", async () => {
    const chat = mockChat({
      ok: true,
      content: JSON.stringify(VALID_RESPONSE),
    });
    const cache = mockCache();

    await parseQueryIntent("露營要帶什麼杯子呢", {
      client: chat,
      cache,
    });

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      "露營要帶什麼杯子呢",
      expect.any(String),
    );
  });

  it("nulls out nonexistent subcategory when category is null (F3)", async () => {
    const chat = mockChat({
      ok: true,
      content: JSON.stringify({
        category: null,
        subcategory: "invented-slug-that-does-not-exist",
        materials: [],
      }),
    });
    const cache = mockCache();

    const result = await parseQueryIntent("想找一些特別的東西送人", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.parsed.subcategory).toBeNull();
  });

  it("validates subcategory on cache hit (F4)", async () => {
    // Simulate a stale cache entry with a subcategory that doesn't match category
    const staleEntry = JSON.stringify({
      category: "outdoor",
      subcategory: "earrings", // belongs to jewelry, not outdoor
      materials: [],
    });
    const store = new Map<string, string>();
    store.set("露營要帶什麼東西好", staleEntry);
    const cache = mockCache(store);
    const chat = mockChat({ ok: true, content: "should not be called" });

    const result = await parseQueryIntent("露營要帶什麼東西好", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.cacheHit).toBe(true);
    expect(result!.parsed.subcategory).toBeNull();
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it("validates nonexistent subcategory on cache hit (F4+F3)", async () => {
    // Simulate a stale cache entry with a subcategory that doesn't exist at all
    const staleEntry = JSON.stringify({
      category: null,
      subcategory: "bogus-slug",
      materials: [],
    });
    const store = new Map<string, string>();
    store.set("想找一些特別的禮物", staleEntry);
    const cache = mockCache(store);
    const chat = mockChat({ ok: true, content: "should not be called" });

    const result = await parseQueryIntent("想找一些特別的禮物", {
      client: chat,
      cache,
    });

    expect(result).not.toBeNull();
    expect(result!.cacheHit).toBe(true);
    expect(result!.parsed.subcategory).toBeNull();
  });
});
