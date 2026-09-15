/**
 * LLM-based query intent extraction for /discover?q= search.
 *
 * Parses a free-text situation query into structured filters (category,
 * subcategory, materials). Uses the closed taxonomy from ontology.ts as the
 * extraction vocabulary.
 */

import { z } from "zod";
import { createProfiledOpenAIClient, profileChatParams } from "./llm-audit";
import { parseAndValidate, toStrictJsonSchema } from "./_shared/zod-schema";
import {
  L1_CATEGORIES,
  MATERIALS,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
} from "@/lib/prompts/shared";
import type { IntentParseCache } from "@/lib/cache/intent-parse-cache";
import { getDefaultIntentParseCache } from "@/lib/cache/intent-parse-cache";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTENT_PARSE_MIN_CJK = 6;

const L1_SLUGS = L1_CATEGORIES.map((c) => c.slug);
const MATERIAL_SLUGS = MATERIALS.map((m) => m.slug);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const intentParseShape = z.object({
  category: z
    .enum(L1_SLUGS as unknown as [string, ...string[]])
    .nullable(),
  subcategory: z.string().nullable(),
  materials: z.array(
    z.enum(MATERIAL_SLUGS as unknown as [string, ...string[]]),
  ),
});

const INTENT_PARSE_JSON_SCHEMA = {
  name: "intent_parse_response",
  schema: toStrictJsonSchema(intentParseShape),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentParseResult = z.infer<typeof intentParseShape>;

export type IntentParseOutcome = {
  parsed: IntentParseResult;
  cacheHit: boolean;
} | null;

type ChatFn = {
  chat: (input: {
    system: string;
    user: string;
    schema?: { name: string; schema: Record<string, unknown> };
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }) => Promise<{ ok: boolean; content: string | null }>;
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    "Extract structured filters from the user's query using ONLY the closed taxonomy below.",
    "When unsure about a filter, leave it null.",
    "",
    "## L1 Categories",
    CATEGORY_LIST,
    "",
    "## L2 Subcategories (grouped by parent L1, with aliases)",
    SUBCATEGORY_VOCAB_BLOCK,
    "",
    "## Materials",
    MATERIAL_VOCAB_BLOCK,
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ---------------------------------------------------------------------------
// Subcategory validation — shared between cache-hit and post-LLM paths
// ---------------------------------------------------------------------------

/**
 * Validates the subcategory against the closed taxonomy:
 * (a) The subcategory slug must exist in L2_SUBCATEGORIES.
 * (b) When both category and subcategory are present, the subcategory must
 *     belong to that category.
 * Returns a new object with subcategory nulled out if invalid.
 */
function validateSubcategory(data: IntentParseResult): IntentParseResult {
  if (!data.subcategory) return data;

  const sub = subcategoryBySlug(data.subcategory);
  if (!sub) {
    // Subcategory slug doesn't exist at all
    return { ...data, subcategory: null };
  }
  if (data.category && sub.category !== data.category) {
    // Subcategory exists but belongs to a different L1
    return { ...data, subcategory: null };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * Matches Han-script characters for counting "meaningful" query length, the
 * same `\p{Script=Han}` approach `generateSlug` in brands.ts uses.
 */
const CJK_RE = /\p{Script=Han}/gu;

export function shouldAttemptIntentParse(query: string): boolean {
  if (!query) return false;
  const cjkChars = query.match(CJK_RE);
  return (cjkChars?.length ?? 0) >= INTENT_PARSE_MIN_CJK;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

type ParseOptions = {
  client?: ChatFn;
  cache?: IntentParseCache;
};

export async function parseQueryIntent(
  query: string,
  options?: ParseOptions,
): Promise<IntentParseOutcome> {
  const cache = options?.cache ?? getDefaultIntentParseCache();

  // 1. Check cache — fail-open on any error
  try {
    const cached = await cache.get(query);
    if (cached !== null) {
      const parsed = parseAndValidate(cached, intentParseShape);
      if (parsed.success) {
        return { parsed: validateSubcategory(parsed.data), cacheHit: true };
      }
      // Stale/corrupt cache entry — fall through to LLM
    }
  } catch {
    // cache error — fall through to LLM (fail-open)
  }

  // 2. Call LLM
  const client =
    options?.client ??
    createProfiledOpenAIClient("intentParse", { phase: "intentParse" });

  const profile = profileChatParams("intentParse");

  try {
    const result = await client.chat({
      system: SYSTEM_PROMPT,
      user: query,
      schema: INTENT_PARSE_JSON_SCHEMA,
      json: true,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      timeoutMs: profile.timeoutMs,
    });

    if (!result.ok) {
      return null;
    }
    if (!result.content) {
      return null;
    }

    const parsed = parseAndValidate(result.content, intentParseShape);
    if (!parsed.success) {
      return null;
    }

    // 3. Validate subcategory against closed taxonomy
    const data = validateSubcategory(parsed.data);

    // 4. Cache on success
    try {
      await cache.set(query, JSON.stringify(data));
    } catch {
      // fail-open
    }

    return { parsed: data, cacheHit: false };
  } catch {
    // AbortError from timeout, network errors, etc. — all return null
    return null;
  }
}
