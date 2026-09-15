import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createIntentParseCache,
  cacheKey,
} from "../intent-parse-cache";

describe("intent-parse-cache", () => {
  describe("cacheKey", () => {
    it("key format is intent:<8-char-hash>:<sha256>", () => {
      const key = cacheKey("hello");
      // Should match intent:<8chars>:<64-char-hex>
      expect(key).toMatch(/^intent:[a-f0-9]{8}:[a-f0-9]{64}$/);
    });

    it("strips punctuation — query with and without trailing question mark produce same key", () => {
      const withPunctuation = cacheKey("露營要帶的杯子？");
      const withoutPunctuation = cacheKey("露營要帶的杯子");
      expect(withPunctuation).toBe(withoutPunctuation);
    });

    it("lowercases latin — 'Outdoor杯子' and 'outdoor杯子' produce same key", () => {
      const upper = cacheKey("Outdoor杯子");
      const lower = cacheKey("outdoor杯子");
      expect(upper).toBe(lower);
    });
  });

  describe("get", () => {
    it("returns null on cache miss", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createIntentParseCache({ redis: mockRedis as any });
      const result = await cache.get("unknown query");
      expect(result).toBeNull();
    });

    it("fails open — returns null when Redis throws", async () => {
      const mockRedis = {
        get: vi.fn().mockRejectedValue(new Error("connection refused")),
        set: vi.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createIntentParseCache({ redis: mockRedis as any });
      const result = await cache.get("test query");
      expect(result).toBeNull();
    });
  });

  describe("round-trip", () => {
    let store: Map<string, string>;
    let mockRedis: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      store = new Map();
      mockRedis = {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(
          async (key: string, value: string, _opts?: { ex?: number }) => {
            store.set(key, value);
          },
        ),
      };
    });

    it("set then get round-trips a JSON string", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Redis
      const cache = createIntentParseCache({ redis: mockRedis as any });
      const json = JSON.stringify({ category: "outdoor", materials: [] });
      await cache.set("露營杯子", json);
      const result = await cache.get("露營杯子");
      expect(result).toBe(json);
    });
  });

  describe("cacheKey — fullwidth handling (F8)", () => {
    it("does not strip fullwidth alphanumerics", () => {
      // Ａ = U+FF21 (fullwidth A), ０ = U+FF10 (fullwidth 0)
      // These should be preserved, producing different keys than empty input
      const withFullwidthAlpha = cacheKey("Ａ杯子");
      const withoutAlpha = cacheKey("杯子");
      expect(withFullwidthAlpha).not.toBe(withoutAlpha);
    });

    it("still strips fullwidth punctuation", () => {
      // ？ = U+FF1F (fullwidth ?), should be stripped
      const withFullwidthPunct = cacheKey("杯子？");
      const withoutPunct = cacheKey("杯子");
      expect(withFullwidthPunct).toBe(withoutPunct);
    });
  });
});
