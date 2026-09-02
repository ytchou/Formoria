import { createHash } from "node:crypto";

const TTL_SECONDS = 86400; // 24 hours

export interface QueryEmbeddingCache {
  get(normalizedQuery: string, model: string): Promise<number[] | null>;
  set(normalizedQuery: string, model: string, embedding: number[]): Promise<void>;
}

/**
 * Builds the cache key: `emb:v1:<model>:<sha256(normalizedQuery)>`
 */
export async function cacheKey(
  normalizedQuery: string,
  model: string,
): Promise<string> {
  const hash = createHash("sha256").update(normalizedQuery).digest("hex");
  return `emb:v1:${model}:${hash}`;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
}

type CacheOptions =
  | { redis: RedisLike; redisUrl?: never; redisToken?: never }
  | { redis?: never; redisUrl: string | undefined; redisToken: string | undefined };

/**
 * Upstash Redis-backed embedding cache. Fail-open: every Redis op is
 * wrapped in try/catch so a cache failure never blocks a search.
 */
export function createQueryEmbeddingCache(
  options: CacheOptions,
): QueryEmbeddingCache {
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
    async get(normalizedQuery: string, model: string): Promise<number[] | null> {
      if (!redis) return null;
      try {
        const key = await cacheKey(normalizedQuery, model);
        const raw = await redis.get(key);
        if (raw === null) return null;
        // @upstash/redis auto-deserializes JSON, so `raw` may already be number[].
        if (typeof raw === "object" && Array.isArray(raw)) return raw;
        return JSON.parse(raw) as number[];
      } catch {
        return null;
      }
    },

    async set(
      normalizedQuery: string,
      model: string,
      embedding: number[],
    ): Promise<void> {
      if (!redis) return;
      try {
        const key = await cacheKey(normalizedQuery, model);
        await redis.set(key, JSON.stringify(embedding), { ex: TTL_SECONDS });
      } catch {
        // fail-open
      }
    },
  };
}

/**
 * Default cache instance, created from env vars. Singleton per process.
 */
let _defaultCache: QueryEmbeddingCache | null = null;

export function getDefaultQueryEmbeddingCache(): QueryEmbeddingCache {
  if (!_defaultCache) {
    _defaultCache = createQueryEmbeddingCache({
      redisUrl: process.env.UPSTASH_REDIS_REST_URL,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _defaultCache;
}
