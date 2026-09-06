import { describe, expect, it, vi, beforeEach } from "vitest";
import { createQueryEmbeddingCache, cacheKey } from "./query-embedding-cache";

describe("query-embedding-cache", () => {
  const MODEL = "text-embedding-3-small";

  describe("cacheKey", () => {
    it("key is emb:v1:<model>:<sha256(normalized)>", async () => {
      const key = await cacheKey("hello", MODEL);
      // SHA-256 of "hello" is 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      expect(key).toBe(
        `emb:v1:${MODEL}:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`,
      );
    });
  });

  describe("get returns null and set is a no-op when Upstash env is missing", () => {
    it("gracefully degrades", async () => {
      const cache = createQueryEmbeddingCache({
        redisUrl: undefined,
        redisToken: undefined,
      });
      const result = await cache.get("test", MODEL);
      expect(result).toBeNull();
      // set should not throw
      await cache.set("test", MODEL, [1, 2, 3]);
    });
  });

  describe("get returns null on a Redis error (fail-open)", () => {
    it("catches and returns null", async () => {
      const mockRedis = {
        get: vi.fn().mockRejectedValue(new Error("connection refused")),
        set: vi.fn().mockRejectedValue(new Error("connection refused")),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createQueryEmbeddingCache({ redis: mockRedis as any });
      const result = await cache.get("test query", MODEL);
      expect(result).toBeNull();
      // set should not throw either
      await cache.set("test query", MODEL, [1, 2, 3]);
    });
  });

  describe("round-trip get/set", () => {
    let store: Map<string, string>;
    let mockRedis: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      store = new Map();
      mockRedis = {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, value: string, opts?: { ex?: number }) => {
          void opts;
          store.set(key, value);
        }),
      };
    });

    it("stores and retrieves embedding vectors", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createQueryEmbeddingCache({ redis: mockRedis as any });
      const embedding = [0.1, 0.2, 0.3];
      await cache.set("query", MODEL, embedding);
      const result = await cache.get("query", MODEL);
      expect(result).toEqual(embedding);
    });

    it("handles Upstash auto-deserialized array (not a string)", async () => {
      // @upstash/redis auto-deserializes JSON, so get() may return number[] instead of string
      const autoDeserializeRedis = {
        get: vi.fn(async () => [0.1, 0.2, 0.3]),
        set: vi.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createQueryEmbeddingCache({ redis: autoDeserializeRedis as any });
      const result = await cache.get("query", MODEL);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("passes TTL to set", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createQueryEmbeddingCache({ redis: mockRedis as any });
      await cache.set("query", MODEL, [1]);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { ex: 86400 },
      );
    });
  });
});
