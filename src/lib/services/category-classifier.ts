import { fetchLangfusePromptWithMeta } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
import {
  createProfiledOpenAIClient,
  profileChatParams,
} from "@/lib/services/llm-audit";
import { z } from "zod";
import {
  parseAndValidate,
  toStrictJsonSchema,
  formatRetryInstruction,
} from "./_shared/zod-schema";
import {
  contentFailed,
  notAttempted,
  providerFailed,
  type LlmCallOutcome,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import {
  DETECT_MESSAGE_LABELS as L,
  MAX_PROBE_URLS,
  MAX_RESULT_LINES,
} from "@/lib/prompts/detect-message";
import { pageKeyHost } from "./link-enrichment";
import {
  hasHeadText,
  isUsableProbe,
  type DetectResultLine,
} from "./enrich-phases/detect-evidence";
import type { ProbeEvidence } from "./enrich-phases/gather";

// Re-exported: the orchestrator and tests read the probe cap from here.
export { MAX_PROBE_URLS };

export type DetectItem = {
  slug: string;
  name: string;
  description: string | null;
  website: string | null;
  /** The `website_url` the brand was submitted with. */
  submittedWebsite?: string | null;
  /**
   * Gather's SERP results for the brand name, each tagged with whether the
   * link sits on one of the brand's own URLs (`enrich-phases/detect-evidence.ts`).
   */
  results?: DetectResultLine[];
  /**
   * What a free HTTP GET on the brand's own known URLs found in each `<head>`
   * (`enrich-phases/gather.ts`). Search results describe what the web says
   * about the brand; a probe is the brand's own page saying what it is, which
   * is the cheapest evidence available for the non-brand call and the only one
   * a search-less brand has. A failed probe without head text renders as
   * unreachable, with its HTTP status when one came back. Filtered, ordered and
   * capped by `detectProbes` (`enrich-phases/detect-evidence.ts`).
   */
  probes?: ProbeEvidence[];
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

// Wire-format schemas for OpenAI structured output
const DETECT_SCHEMA = {
  name: "detect_single",
  schema: toStrictJsonSchema(detectSingleShape),
};

type UnknownRecord = Record<string, unknown>;

function createDetectClient(
  apiKey: string,
  target: EnrichmentTarget | undefined,
  jobId?: string,
  prompt?: { name: string; version: number; source: "langfuse" | "snapshot" },
) {
  return createProfiledOpenAIClient(
    "detect",
    {
      target,
      phase: "detect",
      ...(jobId ? { jobId } : {}),
      ...(prompt ? { prompt } : {}),
    },
    { apiKey },
  );
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

/** Each probe line's head text is capped at 160 characters. */
const PROBE_LINE_CHARS = 160;

function headText(probe: ProbeEvidence): string {
  return [probe.title, probe.description]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" — ");
}

function resultLine(result: DetectResultLine): string {
  const title = result.title.trim();
  const snippet = result.snippet?.trim();
  // A title-less result leads with its snippet, with no leading " — ".
  const head = title && snippet ? `${title} — ${snippet}` : title || snippet || "";
  const tag =
    result.match === "site"
      ? `，${L.tagSite}`
      : result.match === "instagram"
        ? `，${L.tagInstagram}`
        : "";
  return `${L.searchResult}：${head}（${result.host}${tag}）`;
}

function probeLine(probe: ProbeEvidence): string {
  if (!hasHeadText(probe)) {
    const status =
      probe.status !== undefined ? `（HTTP ${probe.status}）` : "";
    return `${L.probe}：${pageKeyHost(probe.url)} — ${L.unreachable}${status}`;
  }
  // Cap the head text first so the platform and follower suffix survive it.
  let value = headText(probe).slice(0, PROBE_LINE_CHARS);
  if (probe.platform) value += ` (${probe.platform})`;
  if (probe.instagramFollowers !== undefined) {
    const followers = probe.instagramFollowers.toLocaleString("en-US");
    value += `，${L.igFollowers} ${followers}`;
  }
  return `${L.probe}：${value}`;
}

/**
 * The detect user message for one brand. Pure, and the only template: the
 * production call and the golden-set regenerate script both render through it,
 * so the model sees byte-identical messages in both.
 *
 * `detectProbes` owns the probe policy. The renderer re-applies it (same
 * predicates, same cap) because eval fixtures (`jev-questions.test.ts`,
 * `scripts/jev/smoke.ts`) hand it probes that never passed through there;
 * on `detectProbes` output it is a no-op.
 */
export function renderDetectUserMessage(item: DetectItem): string {
  const probes = (item.probes ?? [])
    .filter(isUsableProbe)
    .sort((a, b) => Number(!hasHeadText(a)) - Number(!hasHeadText(b)))
    .slice(0, MAX_PROBE_URLS);

  return [
    `${L.brandSlug}：${item.slug}`,
    `${L.brandName}：${item.name}`,
    `${L.description}：${item.description ?? L.missing}`,
    `${L.website}：${item.website ?? L.missing}`,
    `${L.submittedWebsite}：${item.submittedWebsite ?? L.missing}`,
    ...(item.results ?? []).slice(0, MAX_RESULT_LINES).map(resultLine),
    ...probes.map(probeLine),
  ].join("\n");
}

/**
 * One detect call for one brand. Every brand gets its own call (DEV-1886): the
 * batched path averaged 5.5 brands per call on staging for ~3% of LLM spend, so
 * batching bought little and split the pipeline into two shapes. The prompt
 * judges each entity from its own name, sites, search results and probes only.
 */
export async function detectBrand(
  brand: DetectItem,
  jobId?: string,
): Promise<LlmCallOutcome<DetectResult>> {
  return auditedCall(
    { provider: "enrich", operation: "detectBrand", kind: "service" },
    () => detectBrandCall(brand, jobId),
  );
}

async function detectBrandCall(
  brand: DetectItem,
  jobId?: string,
): Promise<LlmCallOutcome<DetectResult>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const userContent = renderDetectUserMessage(brand);

  try {
    const { text: detectPrompt, prompt: detectPromptMeta } = await fetchLangfusePromptWithMeta("detect");

    const client = createDetectClient(
      token,
      brand.target,
      jobId,
      detectPromptMeta,
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
