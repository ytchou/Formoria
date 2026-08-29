import {
  CLASSIFY_SYSTEM_PROMPT,
  DETECT_SYSTEM_PROMPT,
  CATEGORY_LIST,
} from "@/lib/prompts";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
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

const VALID_CATEGORY_SLUGS = new Set<string>(
  L1_CATEGORIES.map((category) => category.slug),
);

const L1_SLUGS = L1_CATEGORIES.map((c) => c.slug);

// ---------------------------------------------------------------------------
// Structured output schemas — passed to OpenAI via `schema:` alongside `json: true`
// ---------------------------------------------------------------------------

const DETECT_SINGLE_PROPERTIES = {
  reasoning: { type: "string" },
  isNonBrand: { type: "boolean" },
  nonBrandReason: { type: ["string", "null"] },
  brand_name: { type: ["string", "null"] },
  slug_generated: { type: ["string", "null"] },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
} as const;

export const DETECT_SCHEMA = {
  name: "detect_single",
  schema: {
    type: "object",
    properties: DETECT_SINGLE_PROPERTIES,
    required: [
      "reasoning",
      "isNonBrand",
      "nonBrandReason",
      "brand_name",
      "slug_generated",
      "confidence",
    ],
    additionalProperties: false,
  },
} as const;

export const DETECT_BATCH_SCHEMA = {
  name: "detect_batch",
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            ...DETECT_SINGLE_PROPERTIES,
          },
          required: [
            "slug",
            "reasoning",
            "isNonBrand",
            "nonBrandReason",
            "brand_name",
            "slug_generated",
            "confidence",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
} as const;

const CLASSIFY_SINGLE_PROPERTIES = {
  reasoning: { type: "string" },
  category: { type: "string", enum: L1_SLUGS },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
} as const;

export const CLASSIFY_SCHEMA = {
  name: "classify_single",
  schema: {
    type: "object",
    properties: CLASSIFY_SINGLE_PROPERTIES,
    required: ["reasoning", "category", "confidence"],
    additionalProperties: false,
  },
} as const;

export const CLASSIFY_BATCH_SCHEMA = {
  name: "classify_batch",
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            ...CLASSIFY_SINGLE_PROPERTIES,
          },
          required: ["slug", "reasoning", "category", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
} as const;

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
) {
  return createProfiledOpenAIClient(
    profileKey,
    {
      target,
      phase,
      ...(jobId ? { jobId } : {}),
    },
    { apiKey },
  );
}

function isConfidence(
  value: unknown,
): value is ClassificationResult["confidence"] {
  return value === "high" || value === "medium" || value === "low";
}

function parseClassification(content: string): ClassificationResult | null {
  const parsed = JSON.parse(content) as UnknownRecord;
  const categorySlug = parsed.category;
  const confidence = parsed.confidence;

  if (
    typeof categorySlug !== "string" ||
    !VALID_CATEGORY_SLUGS.has(categorySlug) ||
    !isConfidence(confidence)
  ) {
    return null;
  }

  return { categorySlug, confidence };
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
  const parsed = JSON.parse(content) as unknown;

  // Structured output wraps in { results: [...] }; legacy responses are bare arrays
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as UnknownRecord).results)
      ? ((parsed as UnknownRecord).results as unknown[])
      : null;

  if (!entries) {
    return null;
  }

  const results = new Map<string, ClassificationResult>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const item = entry as UnknownRecord;
    const slug = item.slug;
    const categorySlug = item.category;
    const confidence = item.confidence;

    if (
      typeof slug !== "string" ||
      !validSlugs.has(slug) ||
      typeof categorySlug !== "string" ||
      !VALID_CATEGORY_SLUGS.has(categorySlug) ||
      !isConfidence(confidence)
    ) {
      continue;
    }

    results.set(slug, { categorySlug, confidence });
  }

  return results;
}

function parseTriageEntry(
  entry: UnknownRecord,
  slug: string,
): DetectResult | null {
  const isNonBrand = entry.isNonBrand;
  const nonBrandReason = entry.nonBrandReason;
  const slugGenerated = entry.slug_generated;
  const confidence = entry.confidence;

  if (typeof isNonBrand !== "boolean" || !isConfidence(confidence)) {
    return null;
  }

  // The detect prompt no longer asks for a category, so the key is normally
  // absent. An absent or unrecognised value is null, never a discarded triage
  // result — the non-brand gate and the name/slug are what this call is for.
  const rawCategory = entry.category;
  const categorySlug =
    typeof rawCategory === "string" && VALID_CATEGORY_SLUGS.has(rawCategory)
      ? rawCategory
      : null;

  const brandName = entry.brand_name;

  return {
    isNonBrand,
    nonBrandReason: typeof nonBrandReason === "string" ? nonBrandReason : null,
    brandName:
      typeof brandName === "string" && brandName.trim().length > 0
        ? brandName.trim()
        : null,
    slug,
    slugGenerated: typeof slugGenerated === "string" ? slugGenerated : null,
    categorySlug,
    confidence,
  };
}

function parseTriageResponse(
  content: string,
  brands: DetectBatchItem[],
): Map<string, DetectResult> | null {
  const parsed = JSON.parse(content) as unknown;

  // Structured output wraps in { results: [...] }; legacy responses are bare arrays
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as UnknownRecord).results)
      ? ((parsed as UnknownRecord).results as unknown[])
      : null;

  if (!entries) {
    return null;
  }

  const validSlugs = new Set(brands.map((brand) => brand.slug));
  const results = new Map<string, DetectResult>();

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const item = entry as UnknownRecord;
    const responseSlug = item.slug;
    const slug =
      typeof responseSlug === "string" && validSlugs.has(responseSlug)
        ? responseSlug
        : brands[index]?.slug;

    if (!slug) return;

    const result = parseTriageEntry(item, slug);
    if (result) {
      results.set(slug, result);
    }
  });

  return results;
}

function parseSingleTriageResponse(
  content: string,
  slug: string,
): DetectResult | null {
  const parsed = JSON.parse(content) as unknown;

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parseTriageEntry(parsed as UnknownRecord, slug);
}

async function classifyCategory(
  brand: BatchClassificationItem,
  jobId?: string,
): Promise<LlmCallOutcome<ClassificationResult>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const userContent = `品牌名稱：${brand.name}\n描述：${brand.description ?? "無"}`;

  const client = createClassifierClient(
    token,
    "classification",
    "classification",
    brand.target,
    jobId,
  );

  try {
    // The 300-token budget and why it is not 100 live with the profile in
    // `@/lib/constants/llm-models`.
    const classifyPrompt = await fetchLangfusePrompt(
      "category-classify",
      CLASSIFY_SYSTEM_PROMPT,
      { category_list: CATEGORY_LIST },
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

  const client = createClassifierClient(
    token,
    "classification",
    "classificationBatch",
    brands.at(0)?.target,
    jobId,
  );

  try {
    const classifyBatchPrompt = await fetchLangfusePrompt(
      "category-classify",
      CLASSIFY_SYSTEM_PROMPT,
      { category_list: CATEGORY_LIST },
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

async function detectBrand(
  brand: DetectBatchItem,
  jobId?: string,
): Promise<LlmCallOutcome<DetectResult>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const snippetLine = brand.snippets?.length
    ? `\n搜尋摘要：${brand.snippets.slice(0, 10).join("；")}`
    : "";
  const userContent = `品牌 slug：${brand.slug}\n品牌名稱：${brand.name}\n描述：${brand.description ?? "無"}\n網站：${brand.website ?? "無"}${snippetLine}`;

  const client = createClassifierClient(
    token,
    "detect",
    "detect",
    brand.target,
    jobId,
  );

  try {
    const detectPrompt = await fetchLangfusePrompt("detect", DETECT_SYSTEM_PROMPT);
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
      return base + snippetStr;
    })
    .join("\n");
  const userContent = `請判斷以下項目是否為實際品牌：\n${list}`;

  const client = createClassifierClient(
    token,
    "detect",
    "detectBatch",
    brands.at(0)?.target,
    jobId,
  );

  try {
    const detectBatchPrompt = await fetchLangfusePrompt("detect", DETECT_SYSTEM_PROMPT);
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
