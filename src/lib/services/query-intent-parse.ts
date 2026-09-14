/**
 * LLM-based query intent extraction for /discover?q= search.
 *
 * Parses a free-text situation query into structured filters (category,
 * subcategory, materials) plus a residual semantic_query. Uses the closed
 * taxonomy from ontology.ts as the extraction vocabulary.
 */

import { z } from "zod";
import { createProfiledOpenAIClient, profileChatParams } from "./llm-audit";
import { parseAndValidate, toStrictJsonSchema } from "./_shared/zod-schema";
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import type { IntentParseCache } from "@/lib/cache/intent-parse-cache";
import { getDefaultIntentParseCache } from "@/lib/cache/intent-parse-cache";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INTENT_PARSE_MIN_CJK = 6;

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
  semantic_query: z.string(),
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
  const categoryLines = L1_CATEGORIES.map(
    (c) => `- ${c.slug} (${c.nameZh})`,
  ).join("\n");

  // Group L2 subcategories under their parent L1
  const subcatByParent = new Map<string, string[]>();
  for (const sub of L2_SUBCATEGORIES) {
    const list = subcatByParent.get(sub.category) ?? [];
    list.push(`${sub.slug} (${sub.nameZh})`);
    subcatByParent.set(sub.category, list);
  }
  const subcategoryLines = L1_CATEGORIES.map((c) => {
    const children = subcatByParent.get(c.slug) ?? [];
    return `## ${c.slug}\n${children.map((s) => `  - ${s}`).join("\n")}`;
  }).join("\n");

  const materialLines = MATERIALS.map(
    (m) => `- ${m.slug} (${m.nameZh})`,
  ).join("\n");

  return [
    "Extract structured filters from the user's query using ONLY the closed taxonomy below.",
    "When unsure about a filter, leave it null. Put everything not mapped to a filter into semantic_query.",
    "",
    "## L1 Categories",
    categoryLines,
    "",
    "## L2 Subcategories (grouped by parent L1)",
    subcategoryLines,
    "",
    "## Materials",
    materialLines,
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * CJK Unicode ranges for counting "meaningful" characters.
 * Matches CJK Unified Ideographs, Extension A, and common CJK ranges.
 */
const CJK_RE =
  /[一-鿿㐀-䶿豈-﫿]/g;

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
        return { parsed: parsed.data, cacheHit: true };
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

    // 3. Validate subcategory belongs to category
    const data = { ...parsed.data };
    if (data.subcategory && data.category) {
      const sub = subcategoryBySlug(data.subcategory);
      if (!sub || sub.category !== data.category) {
        data.subcategory = null;
      }
    }

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
