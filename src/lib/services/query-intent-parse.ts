/**
 * Query intent extraction for /discover?q= search.
 *
 * Parses a free-text situation query into structured filters (category,
 * subcategory, materials) over the closed taxonomy from ontology.ts. Since
 * DEV-1889 the parse runs on Jev (`intent-parse-jev.ts`) through the audited
 * `decide`. `INTENT_PARSE_SYSTEM_PROMPT` and `INTENT_PARSE_JSON_SCHEMA` remain
 * only for the eval's gpt-4o-mini comparison arm (`eval/phase-adapters.ts`).
 */

import { z } from "zod";
import { decide as typesafeDecide } from "./typesafe-audit";
import { createTypesafeClient } from "./typesafe-client";
import { profileChatParams } from "./llm-audit";
import { intentParseJev } from "./intent-parse-jev";
import type { DecideFn } from "./jev-candidate";
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

export const intentParseShape = z.object({
  category: z
    .enum(L1_SLUGS as unknown as [string, ...string[]])
    .nullable(),
  subcategory: z.string().nullable(),
  materials: z.array(
    z.enum(MATERIAL_SLUGS as unknown as [string, ...string[]]),
  ),
});

export const INTENT_PARSE_JSON_SCHEMA = {
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

export const INTENT_PARSE_SYSTEM_PROMPT = buildSystemPrompt();

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
export function validateSubcategory(data: IntentParseResult): IntentParseResult {
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

/** The audited `decide`, on a Jev client bounded by the intentParse profile timeout. */
function defaultIntentDecide(): DecideFn {
  const client = createTypesafeClient({ timeoutMs: profileChatParams("intentParse").timeoutMs });
  return (profileKey, state, questions) => typesafeDecide(profileKey, state, questions, { client });
}

type ParseOptions = {
  /** Jev `decide()`; defaults to typesafe-audit's audited `decide`. */
  decide?: DecideFn;
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
      // Stale/corrupt cache entry — fall through to Jev
    }
  } catch {
    // cache error — fall through to Jev (fail-open)
  }

  // 2. Call Jev with the intentParse profile's per-attempt deadline, as the gpt
  // call had. The caller (product-situation-search) also races this against its
  // own intent deadline and treats a late answer as null.
  const decide = options?.decide ?? defaultIntentDecide();

  try {
    const { output } = await intentParseJev.run(decide, { query });

    // 3. Validate subcategory against closed taxonomy
    const data = validateSubcategory({
      category: output.category,
      subcategory: output.subcategory,
      materials: output.materials,
    });

    // 4. Cache on success
    try {
      await cache.set(query, JSON.stringify(data));
    } catch {
      // fail-open
    }

    return { parsed: data, cacheHit: false };
  } catch {
    // Timeout, API error, unusable answer — all return null (fail-open)
    return null;
  }
}
