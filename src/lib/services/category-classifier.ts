import {
  CLASSIFY_SYSTEM_PROMPT,
  DETECT_SYSTEM_PROMPT,
  CATEGORY_LIST,
} from "@/lib/prompts";
import { fetchLangfusePromptWithMeta } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
import {
  createProfiledOpenAIClient,
  profileChatParams,
} from "@/lib/services/llm-audit";
import {
  LLM_BATCH_CHUNK_SIZE,
  type LlmProfileKey,
} from "@/lib/constants/llm-models";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { z } from "zod";
import {
  parseAndValidate,
  parseBatchEntries,
  toStrictJsonSchema,
  formatRetryInstruction,
} from "./_shared/zod-schema";
import {
  addLlmCalls,
  contentFailed,
  isLlmProviderFailure,
  noLlmCalls,
  notAttempted,
  providerFailed,
  type LlmCallCounts,
  type LlmCallOutcome,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";

export type ClassificationResult = {
  categorySlug: string;
  confidence: "high" | "medium" | "low";
};
export type BatchClassificationItem = {
  slug: string;
  name: string;
  description: string | null;
  target?: EnrichmentTarget;
};
export type DetectBatchItem = {
  slug: string;
  name: string;
  description: string | null;
  website: string | null;
  snippets?: string[];
  /**
   * What a free HTTP GET on the brand's own known URLs found in each `<head>`
   * (`enrich-phases/gather.ts`). SERP snippets describe what the web says about
   * the brand; a probe is the brand's own page saying what it is, which is the
   * cheapest evidence available for the non-brand call and the only one a
   * search-less brand has. Capped and rendered by `probeLines`.
   */
  probes?: Array<{
    url: string;
    title?: string;
    description?: string;
    platform?: string;
  }>;
  target?: EnrichmentTarget;
};
export type DetectResult = {
  isNonBrand: boolean;
  nonBrandReason: string | null;
  brandName: string | null;
  slug: string;
  slugGenerated: string | null;
  /**
   * Always null for a current DETECT run: the category moved to the descriptions
   * phase, which judges it from site content and product image alt text instead
   * of SERP snippets. The field stays so historical `brand_ai_results` rows and
   * any model that still volunteers the key parse without being discarded.
   */
  categorySlug: string | null;
  confidence: "high" | "medium" | "low";
};
export type ExtractionResult = {
  subcategories: string[];
  city: string | null;
  foundingYear: number | null;
  signatureProducts: string[];
  whereToBuy: string | null;
  categoryMismatch: boolean;
};

const L1_SLUGS = L1_CATEGORIES.map((c) => c.slug);

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for both validation and wire format
// ---------------------------------------------------------------------------

const confidenceShape = z.enum(["high", "medium", "low"]);

export const detectSingleShape = z.object({
  reasoning: z.string(),
  isNonBrand: z.boolean(),
  nonBrandReason: z.string().nullable(),
  brand_name: z.string().nullable(),
  slug_generated: z.string().nullable(),
  confidence: confidenceShape,
});

const detectBatchItemShape = detectSingleShape.extend({ slug: z.string() });

export const detectBatchShape = z.object({
  results: z.array(detectBatchItemShape),
});

export const classifySingleShape = z.object({
  reasoning: z.string(),
  category: z.enum(L1_SLUGS as [string, ...string[]]),
  confidence: confidenceShape,
});

const classifyBatchItemShape = classifySingleShape.extend({
  slug: z.string(),
});

export const classifyBatchShape = z.object({
  results: z.array(classifyBatchItemShape),
});

// Wire-format schemas for OpenAI structured output
const DETECT_SCHEMA = {
  name: "detect_single",
  schema: toStrictJsonSchema(detectSingleShape),
};

const DETECT_BATCH_SCHEMA = {
  name: "detect_batch",
  schema: toStrictJsonSchema(detectBatchShape),
};

const CLASSIFY_SCHEMA = {
  name: "classify_single",
  schema: toStrictJsonSchema(classifySingleShape),
};

const CLASSIFY_BATCH_SCHEMA = {
  name: "classify_batch",
  schema: toStrictJsonSchema(classifyBatchShape),
};

// Lenient wrapper for batch parsing — validates structure, not item contents.
// Per-entry validation uses the strict item shapes, so one malformed entry
// does not invalidate the entire batch.
const batchParseShape = z.object({
  results: z.array(z.unknown()),
});

type UnknownRecord = Record<string, unknown>;

/**
 * What a whole batch (chunk calls plus any per-brand fallbacks) did. `results`
 * is always a map — partial results from a partly-healthy run are still usable
 * — and `calls` is what the phase reads to decide `succeeded` vs `failed`.
 */
export type LlmBatchOutcome<T> = {
  results: T;
  calls: LlmCallCounts;
};

function createClassifierClient(
  apiKey: string,
  phase: "classification" | "detect",
  profileKey: LlmProfileKey,
  target: EnrichmentTarget | undefined,
  jobId?: string,
  prompt?: { name: string; version: number },
) {
  return createProfiledOpenAIClient(
    profileKey,
    {
      target,
      phase,
      ...(jobId ? { jobId } : {}),
      ...(prompt ? { prompt } : {}),
    },
    { apiKey },
  );
}

function parseClassification(content: string): ClassificationResult | null {
  const result = parseAndValidate(content, classifySingleShape);
  if (!result.success) {
    if (result.issues) {
      console.error(`  → classify validation: ${formatRetryInstruction(result.issues)}`);
    }
    return null;
  }
  return { categorySlug: result.data.category, confidence: result.data.confidence };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

const VALID_CITY_SLUGS = new Set([
  "taipei",
  "new_taipei",
  "taoyuan",
  "taichung",
  "tainan",
  "kaohsiung",
  "keelung",
  "hsinchu_city",
  "chiayi_city",
  "hsinchu_county",
  "miaoli",
  "changhua",
  "nantou",
  "yunlin",
  "chiayi_county",
  "pingtung",
  "yilan",
  "hualien",
  "taitung",
  "penghu",
  "kinmen",
  "lienchiang",
]);

const CITY_NAME_TO_SLUG: Record<string, string> = {
  台北: "taipei",
  台北市: "taipei",
  "taipei city": "taipei",
  新北: "new_taipei",
  新北市: "new_taipei",
  "new taipei": "new_taipei",
  桃園: "taoyuan",
  桃園市: "taoyuan",
  台中: "taichung",
  台中市: "taichung",
  台南: "tainan",
  台南市: "tainan",
  高雄: "kaohsiung",
  高雄市: "kaohsiung",
  基隆: "keelung",
  基隆市: "keelung",
  新竹市: "hsinchu_city",
  "hsinchu city": "hsinchu_city",
  嘉義市: "chiayi_city",
  "chiayi city": "chiayi_city",
  新竹縣: "hsinchu_county",
  "hsinchu county": "hsinchu_county",
  苗栗: "miaoli",
  苗栗縣: "miaoli",
  彰化: "changhua",
  彰化縣: "changhua",
  南投: "nantou",
  南投縣: "nantou",
  雲林: "yunlin",
  雲林縣: "yunlin",
  嘉義縣: "chiayi_county",
  "chiayi county": "chiayi_county",
  屏東: "pingtung",
  屏東縣: "pingtung",
  宜蘭: "yilan",
  宜蘭縣: "yilan",
  花蓮: "hualien",
  花蓮縣: "hualien",
  台東: "taitung",
  台東縣: "taitung",
  澎湖: "penghu",
  澎湖縣: "penghu",
  金門: "kinmen",
  金門縣: "kinmen",
  連江: "lienchiang",
  連江縣: "lienchiang",
  馬祖: "lienchiang",
};

function mapCityToSlug(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (VALID_CITY_SLUGS.has(trimmed)) return trimmed;
  const mapped =
    CITY_NAME_TO_SLUG[trimmed] ?? CITY_NAME_TO_SLUG[trimmed.toLowerCase()];
  return mapped ?? null;
}

export function parseExtractionResult(content: string): ExtractionResult {
  try {
    const parsed = JSON.parse(content) as UnknownRecord;
    const foundingYear =
      typeof parsed.founding_year === "number" &&
      Number.isInteger(parsed.founding_year)
        ? parsed.founding_year
        : null;

    return {
      subcategories: parseStringArray(parsed.subcategories).slice(0, 5),
      city: mapCityToSlug(parseNullableString(parsed.city)),
      foundingYear,
      signatureProducts: parseStringArray(parsed.signature_products).slice(
        0,
        10,
      ),
      whereToBuy: parseNullableString(parsed.where_to_buy),
      categoryMismatch: parsed.category_mismatch === true,
    };
  } catch {
    return {
      subcategories: [],
      city: null,
      foundingYear: null,
      signatureProducts: [],
      whereToBuy: null,
      categoryMismatch: false,
    };
  }
}

function parseBatchClassification(
  content: string,
  validSlugs: Set<string>,
): Map<string, ClassificationResult> | null {
  const parsed = parseBatchEntries(content, batchParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → classify batch validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }

  const results = new Map<string, ClassificationResult>();

  for (const entry of parsed.entries) {
    const validated = classifyBatchItemShape.safeParse(entry);
    if (!validated.success) continue;

    const { slug, category, confidence } = validated.data;
    if (!validSlugs.has(slug)) continue;

    results.set(slug, { categorySlug: category, confidence });
  }

  return results;
}

/**
 * Map a validated detect entry to a DetectResult. The detect prompt no longer
 * asks for a category, so categorySlug is always null.
 */
function mapDetectEntry(
  entry: z.infer<typeof detectSingleShape>,
  slug: string,
): DetectResult {
  return {
    isNonBrand: entry.isNonBrand,
    nonBrandReason: entry.nonBrandReason,
    brandName: entry.brand_name?.trim() || null,
    slug,
    slugGenerated: entry.slug_generated,
    categorySlug: null,
    confidence: entry.confidence,
  };
}

function parseTriageResponse(
  content: string,
  brands: DetectBatchItem[],
): Map<string, DetectResult> | null {
  const parsed = parseBatchEntries(content, batchParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → detect batch validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }

  const validSlugs = new Set(brands.map((brand) => brand.slug));
  const results = new Map<string, DetectResult>();

  parsed.entries.forEach((entry, index) => {
    const validated = detectBatchItemShape.safeParse(entry);
    if (!validated.success) return;

    const slug = validSlugs.has(validated.data.slug)
      ? validated.data.slug
      : brands[index]?.slug;
    if (!slug) return;

    results.set(slug, mapDetectEntry(validated.data, slug));
  });

  return results;
}

function parseSingleTriageResponse(
  content: string,
  slug: string,
): DetectResult | null {
  const result = parseAndValidate(content, detectSingleShape);
  if (!result.success) {
    if (result.issues) {
      console.error(`  → detect validation: ${formatRetryInstruction(result.issues)}`);
    }
    return null;
  }

  return mapDetectEntry(result.data, slug);
}

async function classifyCategory(
  brand: BatchClassificationItem,
  jobId?: string,
): Promise<LlmCallOutcome<ClassificationResult>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const userContent = `品牌名稱：${brand.name}\n描述：${brand.description ?? "無"}`;

  // The 300-token budget and why it is not 100 live with the profile in
  // `@/lib/constants/llm-models`.
  try {
    const { text: classifyPrompt, prompt } = await fetchLangfusePromptWithMeta(
      "category-classify",
      CLASSIFY_SYSTEM_PROMPT,
      { category_list: CATEGORY_LIST },
    );

    const client = createClassifierClient(
      token,
      "classification",
      "classification",
      brand.target,
      jobId,
      prompt ?? undefined,
    );

    const { response, data, content } = await client.chat({
      system: classifyPrompt,
      user: userContent,
      json: true,
      schema: CLASSIFY_SCHEMA,
      ...profileChatParams("classification"),
    });

    if (!response.ok) {
      console.error(
        `  → category classification failed: HTTP ${response.status}`,
      );
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → category classification: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const result = parseClassification(content);
    if (!result) {
      console.error(
        `  → category classification: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: result, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → category classification failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

async function classifyCategoryBatchChunk(
  brands: BatchClassificationItem[],
  jobId?: string,
): Promise<LlmCallOutcome<Map<string, ClassificationResult>>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const validSlugs = new Set(brands.map((brand) => brand.slug));
  const list = brands
    .map((brand, index) => {
      return `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? "無"}`;
    })
    .join("\n");
  const userContent = `請將以下品牌分類：\n${list}`;

  try {
    const { text: classifyBatchPrompt, prompt: classifyBatchPromptMeta } = await fetchLangfusePromptWithMeta(
      "category-classify",
      CLASSIFY_SYSTEM_PROMPT,
      { category_list: CATEGORY_LIST },
    );

    const client = createClassifierClient(
      token,
      "classification",
      "classificationBatch",
      brands.at(0)?.target,
      jobId,
      classifyBatchPromptMeta ?? undefined,
    );

    const { response, data, content } = await client.chat({
      system: classifyBatchPrompt,
      user: userContent,
      json: true,
      schema: CLASSIFY_BATCH_SCHEMA,
      ...profileChatParams("classificationBatch"),
    });

    if (!response.ok) {
      console.error(
        `  → category batch classification failed: HTTP ${response.status}`,
      );
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → category batch classification: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const results = parseBatchClassification(content, validSlugs);
    if (!results) {
      console.error(
        `  → category batch classification: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: results, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → category batch classification failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

export async function classifyCategoryBatch(
  brands: BatchClassificationItem[],
  jobId?: string,
): Promise<LlmBatchOutcome<Map<string, ClassificationResult>>> {
  return auditedCall(
    { provider: "enrich", operation: "classifyCategoryBatch", kind: "service" },
    async () => {
      const results = new Map<string, ClassificationResult>();
      let calls = noLlmCalls();

      for (let i = 0; i < brands.length; i += LLM_BATCH_CHUNK_SIZE) {
        const batch = brands.slice(i, i + LLM_BATCH_CHUNK_SIZE);
        const chunk = await classifyCategoryBatchChunk(batch, jobId);
        calls = addLlmCalls(calls, chunk.calls);

        if (chunk.value) {
          for (const [slug, result] of chunk.value) {
            results.set(slug, result);
          }
          continue;
        }

        // The per-brand fallback only makes sense when the model answered and we
        // could not use the answer. If the chunk call itself never reached the
        // provider, every single-brand retry will die the same way — on 2026-08-02
        // that turned one dead batch call into 20 more doomed calls per chunk, each
        // paying its own retry backoff.
        if (isLlmProviderFailure(chunk.calls)) {
          continue;
        }

        for (const brand of batch) {
          const single = await classifyCategory(brand, jobId);
          calls = addLlmCalls(calls, single.calls);
          if (single.value) {
            results.set(brand.slug, single.value);
          }
        }
      }

      return { results, calls };
    },
  );
}

/** At most four probed URLs reach the prompt, at most 160 characters each. */
export const MAX_PROBE_URLS = 4;
const PROBE_LINE_CHARS = 160;

/**
 * One line per probed URL, rendered after the SERP snippets at BOTH detect
 * prompt sites (the batch call and its single-brand retry) so a brand judged by
 * the fallback sees the same evidence as one judged in the batch.
 *
 * A probe with neither title nor description falls back to its URL: the
 * orchestrator only forwards probes that carry head text, but a caller passing
 * a bare one must not render an empty field pair.
 */
function probeLines(probes: DetectBatchItem["probes"]): string[] {
  if (!probes?.length) return [];

  return probes.slice(0, MAX_PROBE_URLS).map((probe) => {
    const head =
      [probe.title, probe.description]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" — ") || probe.url;
    const value = probe.platform ? `${head} (${probe.platform})` : head;
    return `探測：${value.slice(0, PROBE_LINE_CHARS)}`;
  });
}

async function detectBrand(
  brand: DetectBatchItem,
  jobId?: string,
): Promise<LlmCallOutcome<DetectResult>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const snippetLine = brand.snippets?.length
    ? `\n搜尋摘要：${brand.snippets.slice(0, 10).join("；")}`
    : "";
  const probeLine = probeLines(brand.probes)
    .map((line) => `\n${line}`)
    .join("");
  const userContent = `品牌 slug：${brand.slug}\n品牌名稱：${brand.name}\n描述：${brand.description ?? "無"}\n網站：${brand.website ?? "無"}${snippetLine}${probeLine}`;

  try {
    const { text: detectPrompt, prompt: detectPromptMeta } = await fetchLangfusePromptWithMeta("detect", DETECT_SYSTEM_PROMPT);

    const client = createClassifierClient(
      token,
      "detect",
      "detect",
      brand.target,
      jobId,
      detectPromptMeta ?? undefined,
    );

    const { response, data, content } = await client.chat({
      system: detectPrompt,
      user: userContent,
      json: true,
      schema: DETECT_SCHEMA,
      ...profileChatParams("detect"),
    });

    if (!response.ok) {
      console.error(`  → brand triage failed: HTTP ${response.status}`);
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → brand triage: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const result = parseSingleTriageResponse(content, brand.slug);
    if (!result) {
      console.error(
        `  → brand triage: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: result, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → brand triage failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

async function detectBrandsBatchChunk(
  brands: DetectBatchItem[],
  jobId?: string,
): Promise<LlmCallOutcome<Map<string, DetectResult>>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const list = brands
    .map((brand, index) => {
      const base = `${index + 1}. [${brand.slug}] 品牌名：${brand.name} / 描述：${brand.description ?? "無"} / 網站：${brand.website ?? "無"}`;
      const snippetStr = brand.snippets?.length
        ? ` / 搜尋摘要：${brand.snippets.slice(0, 10).join("；")}`
        : "";
      // Indented continuation lines rather than ` / ` fragments: four probes
      // inline would bury the item's own identity line.
      const probeStr = probeLines(brand.probes)
        .map((line) => `\n   ${line}`)
        .join("");
      return base + snippetStr + probeStr;
    })
    .join("\n");
  const userContent = `請判斷以下項目是否為實際品牌：\n${list}`;

  try {
    const { text: detectBatchPrompt, prompt: detectBatchPromptMeta } = await fetchLangfusePromptWithMeta("detect", DETECT_SYSTEM_PROMPT);

    const client = createClassifierClient(
      token,
      "detect",
      "detectBatch",
      brands.at(0)?.target,
      jobId,
      detectBatchPromptMeta ?? undefined,
    );

    const { response, data, content } = await client.chat({
      system: detectBatchPrompt,
      user: userContent,
      json: true,
      schema: DETECT_BATCH_SCHEMA,
      ...profileChatParams("detectBatch"),
    });

    if (!response.ok) {
      console.error(`  → brand triage batch failed: HTTP ${response.status}`);
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → brand triage batch: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const results = parseTriageResponse(content, brands);
    if (!results) {
      console.error(
        `  → brand triage batch: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: results, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → brand triage batch failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

export async function detectBrandsBatch(
  brands: DetectBatchItem[],
  jobId?: string,
): Promise<LlmBatchOutcome<Map<string, DetectResult>>> {
  return auditedCall(
    { provider: "enrich", operation: "detectBrandsBatch", kind: "service" },
    async () => {
      const results = new Map<string, DetectResult>();
      let calls = noLlmCalls();

      for (let i = 0; i < brands.length; i += LLM_BATCH_CHUNK_SIZE) {
        const batch = brands.slice(i, i + LLM_BATCH_CHUNK_SIZE);
        const chunk = await detectBrandsBatchChunk(batch, jobId);
        calls = addLlmCalls(calls, chunk.calls);

        if (chunk.value) {
          for (const [slug, result] of chunk.value) {
            results.set(slug, result);
          }
          continue;
        }

        // Same rule as the classifier above: a provider-level chunk failure means
        // the account, not the payload, is the problem — 20 single-brand retries
        // would only multiply the outage.
        if (isLlmProviderFailure(chunk.calls)) {
          continue;
        }

        for (const brand of batch) {
          const single = await detectBrand(brand, jobId);
          calls = addLlmCalls(calls, single.calls);
          if (single.value) {
            results.set(brand.slug, single.value);
          }
        }
      }

      return { results, calls };
    },
  );
}
