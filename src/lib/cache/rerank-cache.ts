import { createHash } from "node:crypto";

const TTL_SECONDS = 86400; // 24 hours

export interface RerankCache {
  get(query: string, reranker: string): Promise<string[] | null>;
  set(query: string, reranker: string, ids: string[]): Promise<void>;
}

/**
 * Builds the cache key: `rerank:v1:<reranker>:<sha256(query)>`
 */
export function rerankCacheKey(query: string, reranker: string): string {
  const hash = createHash("sha256").update(query).digest("hex");
  return `rerank:v1:${reranker}:${hash}`;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
}

type CacheOptions =
  | { redis: RedisLike; redisUrl?: never; redisToken?: never }
  | { redis?: never; redisUrl: string | undefined; redisToken: string | undefined };

/**
 * Upstash Redis-backed rerank result cache. Fail-open: every Redis op is
 * wrapped in try/catch so a cache failure never blocks a search.
 */
export function createRerankCache(options: CacheOptions): RerankCache {
  let redis: RedisLike | null = null;

  if ("redis" in options && options.redis) {
    redis = options.redis;
  } else if (options.redisUrl && options.redisToken) {
    // Lazy-import to avoid pulling @upstash/redis when env is missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    redis = new Redis({ url: options.redisUrl, token: options.redisToken });
  }

  return {
    async get(query: string, reranker: string): Promise<string[] | null> {
      if (!redis) return null;
      try {
        const key = rerankCacheKey(query, reranker);
        const raw = await redis.get(key);
        if (raw === null) return null;
        // @upstash/redis auto-deserializes JSON, so `raw` may already be string[].
        if (typeof raw === "object" && Array.isArray(raw)) return raw;
        return JSON.parse(raw) as string[];
      } catch {
        return null;
      }
    },

    async set(query: string, reranker: string, ids: string[]): Promise<void> {
      if (!redis) return;
      try {
        const key = rerankCacheKey(query, reranker);
        await redis.set(key, JSON.stringify(ids), { ex: TTL_SECONDS });
      } catch {
        // fail-open
      }
    },
  };
}

/**
 * Default cache instance, created from env vars. Singleton per process.
 */
let _defaultCache: RerankCache | null = null;

export function getDefaultRerankCache(): RerankCache {
  if (!_defaultCache) {
    _defaultCache = createRerankCache({
      redisUrl: process.env.UPSTASH_REDIS_REST_URL,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _defaultCache;
}
