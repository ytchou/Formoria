import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRerankCache, rerankCacheKey } from "./rerank-cache";

type RedisFn<T> = (...args: never[]) => Promise<T>;

function mockRedisGet() {
  return vi.fn<RedisFn<string | null>>();
}
function mockRedisSet() {
  return vi.fn<RedisFn<unknown>>();
}

describe("rerank-cache", () => {
  const RERANKER = "cohere-rerank-v3.5";

  describe("rerankCacheKey", () => {
    it("key matches rerank:v1:<reranker>:<sha256(query)>", () => {
      const key = rerankCacheKey("hello", RERANKER);
      expect(key).toBe(
        `rerank:v1:${RERANKER}:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`,
      );
    });
  });

  describe("cache miss", () => {
    it("get returns null when key does not exist", async () => {
      const redis = { get: mockRedisGet().mockResolvedValue(null), set: mockRedisSet() };
      const cache = createRerankCache({ redis });
      const result = await cache.get("nonexistent query", RERANKER);
      expect(result).toBeNull();
    });
  });

  describe("round-trip get/set", () => {
    let store: Map<string, string>;
    let redis: { get: ReturnType<typeof mockRedisGet>; set: ReturnType<typeof mockRedisSet> };

    beforeEach(() => {
      store = new Map();
      redis = {
        get: mockRedisGet().mockImplementation(async (...args: unknown[]) => store.get(args[0] as string) ?? null),
        set: mockRedisSet().mockImplementation(async (...args: unknown[]) => { store.set(args[0] as string, args[1] as string); }),
      };
    });

    it("set then get returns stored ids", async () => {
      const cache = createRerankCache({ redis });
      const ids = ["prod-1", "prod-2", "prod-3"];
      await cache.set("best moisturizer", RERANKER, ids);
      const result = await cache.get("best moisturizer", RERANKER);
      expect(result).toEqual(ids);
    });
  });

  describe("fail-open on Redis errors", () => {
    it("get returns null on Redis error", async () => {
      const redis = {
        get: mockRedisGet().mockRejectedValue(new Error("connection refused")),
        set: mockRedisSet(),
      };
      const cache = createRerankCache({ redis });
      const result = await cache.get("test query", RERANKER);
      expect(result).toBeNull();
    });

    it("set swallows Redis error", async () => {
      const redis = {
        get: mockRedisGet(),
        set: mockRedisSet().mockRejectedValue(new Error("connection refused")),
      };
      const cache = createRerankCache({ redis });
      await expect(
        cache.set("test query", RERANKER, ["id-1"]),
      ).resolves.toBeUndefined();
    });
  });
});
