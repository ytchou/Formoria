import { createHash } from "node:crypto";
import { L1_CATEGORIES, L2_SUBCATEGORIES, MATERIALS } from "@/lib/taxonomy/ontology";

const TTL_SECONDS = 604800; // 7 days

/**
 * Taxonomy hash: first 8 hex chars of SHA-256 over the sorted L1 + L2 +
 * material slugs. Busts the cache when the taxonomy vocabulary changes.
 */
const TAXONOMY_HASH = (() => {
  const payload = [
    ...L1_CATEGORIES.map((c) => c.slug),
    ...L2_SUBCATEGORIES.map((s) => s.slug),
    ...MATERIALS.map((m) => m.slug),
  ]
    .sort()
    .join(",");
  return createHash("sha256").update(payload).digest("hex").slice(0, 8);
})();

/**
 * Regex stripping CJK punctuation, fullwidth punctuation (NOT fullwidth
 * alphanumerics), and common Latin punctuation before hashing, so
 * surface-level punctuation differences (trailing "？" vs none) collapse to
 * the same cache key.
 *
 * Ranges:
 *   U+3000-U+303F  CJK Symbols and Punctuation (includes 。、「」『』【】etc.)
 *   U+FF01-U+FF0F  Fullwidth punctuation (！＂＃…／)
 *   U+FF1A-U+FF20  Fullwidth punctuation (：；…＠)
 *   U+FF3B-U+FF40  Fullwidth brackets (［＼…｀)
 *   U+FF5B-U+FF65  Fullwidth braces / halfwidth CJK punct (｛｜…･)
 *   U+FE30-U+FE4F  CJK Compatibility Forms (︰…﹏)
 */
const STRIP_RE =
  /[　-〿！-／：-＠［-｀｛-･︰-﹏\s.,;:!?"'()\[\]{}]/g;

function normalizeForKey(query: string): string {
  return query.replace(STRIP_RE, "").toLowerCase();
}

/**
 * Builds the cache key: `intent:<TAXONOMY_HASH_8>:<sha256(stripped_query)>`
 */
export function cacheKey(query: string): string {
  const normalized = normalizeForKey(query);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `intent:${TAXONOMY_HASH}:${hash}`;
}

export interface IntentParseCache {
  get(query: string): Promise<string | null>;
  set(query: string, json: string): Promise<void>;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
}

type CacheOptions =
  | { redis: RedisLike; redisUrl?: never; redisToken?: never }
  | {
      redis?: never;
      redisUrl: string | undefined;
      redisToken: string | undefined;
    };

/**
 * Upstash Redis-backed intent-parse cache. Fail-open: every Redis op is
 * wrapped in try/catch so a cache failure never blocks a search.
 */
export function createIntentParseCache(options: CacheOptions): IntentParseCache {
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
    async get(query: string): Promise<string | null> {
      if (!redis) return null;
      try {
        const key = cacheKey(query);
        const raw = await redis.get(key);
        if (raw === null) return null;
        // @upstash/redis auto-deserializes JSON, so `raw` may be an object.
        if (typeof raw === "string") return raw;
        return JSON.stringify(raw);
      } catch {
        return null;
      }
    },

    async set(query: string, json: string): Promise<void> {
      if (!redis) return;
      try {
        const key = cacheKey(query);
        await redis.set(key, json, { ex: TTL_SECONDS });
      } catch {
        // fail-open
      }
    },
  };
}

/**
 * Default cache instance, created from env vars. Singleton per process.
 */
let _defaultCache: IntentParseCache | null = null;

export function getDefaultIntentParseCache(): IntentParseCache {
  if (!_defaultCache) {
    _defaultCache = createIntentParseCache({
      redisUrl: process.env.UPSTASH_REDIS_REST_URL,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _defaultCache;
}
