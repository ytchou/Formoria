import { FACTS_SYSTEM_PROMPT } from "@/lib/prompts";
import { parseJson } from "./openai-client";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
  type LlmAuditContext,
} from "./llm-audit";
import { localizeToTW } from "./taiwan-localization";
import { parseExtractionResult } from "./product-type-classifier";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { normalizeProductTags } from "@/lib/services/product-tags";
import { noLlmCalls, type LlmCallCounts } from "./_shared/llm-call-outcome";

function localizeZhText(text: string): string {
  return /[一-鿿]/u.test(text) ? localizeToTW(text).text : text;
}

export type BrandFactsResult = {
  priceRange: 1 | 2 | 3 | null;
  /**
   * The brand's L1 category, decided here rather than at triage because this is
   * the first call that sees the brand's own site text and its product images'
   * alt text. Undefined for an absent or unrecognised value — a made-up slug is
   * a model error, not a reason to discard the rest of the extraction.
   */
  productType?: string;
  productTags: string[];
  productTagsEn: string[];
  city: string | null;
  foundingYear: number | null;
  mitIndicators: {
    mentioned: boolean;
    evidence: string[];
    confidence: string;
  } | null;
  /**
   * Stage-2 listing verdict. Optional and always tolerated as absent: a missing
   * or malformed `listing` means "no opinion", which the consumer treats as
   * `list`.
   */
  listing?: ListingVerdict;
  rejected?: { tag: string; reason: string }[];
  crossBranch?: string[];
  rawResponse?: unknown;
};

const VALID_PRODUCT_TYPES = new Set<string>(
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
);

/**
 * Validates against the real L1 slug list. Anything else — absent, null, a made
 * up slug, a Chinese category name — is undefined, never a rejection.
 */
function parseDescriptionProductType(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return VALID_PRODUCT_TYPES.has(trimmed) ? trimmed : undefined;
}

const LISTING_VERDICTS = ["list", "reject"] as const;
const TAIWAN_CONNECTIONS = [
  "created",
  "designed",
  "manufactured",
  "unclear",
] as const;

export type ListingVerdict = {
  verdict: "list" | "reject";
  reason: string | null;
  taiwanConnection: (typeof TAIWAN_CONNECTIONS)[number] | null;
  hasOwnProducts: boolean | null;
  hasPurchaseChannel: boolean | null;
};

/**
 * Returns undefined for anything unrecognised rather than throwing: an unknown
 * verdict string is a model error, and the correct fallback is "no opinion"
 * (which the consumer treats as `list`), not a discarded extraction.
 */
function parseListingVerdict(raw: unknown): ListingVerdict | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  const listing = raw as Record<string, unknown>;
  const verdict = LISTING_VERDICTS.find((value) => value === listing.verdict);
  if (!verdict) return undefined;

  const taiwanConnection =
    TAIWAN_CONNECTIONS.find((value) => value === listing.taiwan_connection) ??
    null;
  const rawReason =
    typeof listing.reason === "string" ? listing.reason.trim() : "";

  return {
    verdict,
    reason: rawReason.length > 0 ? localizeZhText(rawReason) : null,
    taiwanConnection,
    hasOwnProducts:
      typeof listing.has_own_products === "boolean"
        ? listing.has_own_products
        : null,
    hasPurchaseChannel:
      typeof listing.has_purchase_channel === "boolean"
        ? listing.has_purchase_channel
        : null,
  };
}

const EMPTY_FACTS: BrandFactsResult = {
  priceRange: null,
  productTags: [],
  productTagsEn: [],
  city: null,
  foundingYear: null,
  mitIndicators: null,
};

export function parseBrandFactsResult(content: string): BrandFactsResult {
  const parsed = parseJson<Record<string, unknown>>(content);
  if (!parsed) return { ...EMPTY_FACTS };

  // `parseExtractionResult` owns price/city/year/tags for every extraction call
  // in the pipeline, so the facts call reuses it rather than re-deriving the
  // city slug map and the price tier check a second time.
  const extraction = parseExtractionResult(content);

  const rawProductTagsEn = parsed.product_tags_en;
  const productTagsEnRaw = Array.isArray(rawProductTagsEn)
    ? rawProductTagsEn
        .filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
        .map((t) => t.trim())
    : [];

  const normalizedTags = normalizeProductTags(
    extraction.productTags,
    productTagsEnRaw,
  );

  const rawMit = parsed.mit_indicators;
  const mitIndicators =
    rawMit && typeof rawMit === "object" && !Array.isArray(rawMit)
      ? (() => {
          const mit = rawMit as Record<string, unknown>;
          const mentioned = mit.mentioned === true;
          const evidence = Array.isArray(mit.evidence)
            ? mit.evidence.filter((e): e is string => typeof e === "string")
            : [];
          const confidence =
            typeof mit.confidence === "string" ? mit.confidence : "low";
          return mentioned && evidence.length > 0
            ? { mentioned, evidence, confidence }
            : null;
        })()
      : null;

  const listing = parseListingVerdict(parsed.listing);
  const productType = parseDescriptionProductType(parsed.product_type);

  const acceptedTags =
    normalizedTags.tags.length >= 1 ? normalizedTags.tags : [];
  const acceptedTagsEn =
    normalizedTags.tags.length >= 1 ? normalizedTags.tagsEn : [];

  return {
    priceRange: extraction.priceRange,
    ...(productType ? { productType } : {}),
    productTags: acceptedTags,
    productTagsEn: acceptedTagsEn,
    city: extraction.city,
    foundingYear: extraction.foundingYear,
    mitIndicators,
    rejected: normalizedTags.rejected,
    crossBranch: normalizedTags.crossBranch,
    ...(listing ? { listing } : {}),
  };
}

type BrandFactsAttemptInput = {
  brandName: string;
  userContent: string;
};

export type BrandFactsAttempt = {
  attempt: number;
  input: BrandFactsAttemptInput;
  rawResponse: unknown;
  parsed: BrandFactsResult;
  latencyMs: number;
  config: unknown;
};

export type BrandFactsOutput = {
  /**
   * Null when no attempt produced a usable payload. Callers must read `calls`
   * to learn WHY — a provider outage and a model that answered with an empty
   * body are the same `null` here (see `llm-call-outcome.ts`).
   */
  result: BrandFactsResult | null;
  attempts: BrandFactsAttempt[];
  calls: LlmCallCounts;
};

/** Prompt-shaping params — stored in the audit contract, not sent as request params. */
const FACTS_PROMPT_PARAMS = {
  snippetLimit: 10,
  siteContentLimit: 4000,
};

/**
 * The extraction half of the old descriptions mega-call.
 *
 * There are no field validators here, and that is deliberate: every field is
 * already degraded-not-rejected by its parser (an unrecognised slug becomes
 * undefined, an unmappable city becomes null), so the only failure worth a
 * second call is a response that is not JSON at all.
 */
export async function extractBrandFacts(
  brandName: string,
  userContent: string,
  audit: Pick<LlmAuditContext, "jobId" | "target">,
): Promise<BrandFactsOutput | null> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return null;
  if (!userContent.trim()) return null;

  const attemptInput: BrandFactsAttemptInput = { brandName, userContent };
  const attemptConfig = buildProfiledEnrichmentConfig(
    "facts",
    FACTS_SYSTEM_PROMPT,
    "facts",
    FACTS_PROMPT_PARAMS,
  );
  const attempts: BrandFactsAttempt[] = [];
  // Counted across both attempts: a first call the model answered and a second
  // that hit a spent account is not an outage.
  const calls = noLlmCalls();

  try {
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      const retryInstruction =
        attemptIndex === 0
          ? ""
          : "\n\n前一次輸出無法解析：請只輸出單一 JSON 物件，不要加上說明文字或 Markdown。";

      const startAt = Date.now();
      const client = createProfiledOpenAIClient(
        "facts",
        {
          ...audit,
          phase: "facts",
          attempt: attemptIndex + 1,
          config: attemptConfig,
        },
        { apiKey: token },
      );
      const { response, data, content } = await client.chat({
        system: FACTS_SYSTEM_PROMPT,
        user: `${userContent}${retryInstruction}`,
        json: true,
        ...profileChatParams("facts"),
      });
      const latencyMs = Date.now() - startAt;
      calls.attempted += 1;

      // The only provider-failure site: a non-2xx never reached the model.
      // Everything below is the model having answered, however uselessly.
      if (!response.ok) {
        calls.providerFailed += 1;
        console.error(`  → brand facts failed: HTTP ${response.status}`);
        return { result: null, attempts, calls };
      }

      if (!content) {
        console.error(
          `  → brand facts: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
        );
        return { result: null, attempts, calls };
      }

      const parsed = parseJson<Record<string, unknown>>(content);
      if (!parsed) {
        attempts.push({
          attempt: attemptIndex + 1,
          input: attemptInput,
          rawResponse: data,
          parsed: { ...EMPTY_FACTS },
          latencyMs,
          config: attemptConfig,
        });
        if (attemptIndex === 0) continue;
        return {
          result: { ...EMPTY_FACTS, rawResponse: data },
          attempts,
          calls,
        };
      }

      const result = parseBrandFactsResult(content);
      attempts.push({
        attempt: attemptIndex + 1,
        input: attemptInput,
        rawResponse: data,
        parsed: result,
        latencyMs,
        config: attemptConfig,
      });
      return { result: { ...result, rawResponse: data }, attempts, calls };
    }

    return { result: { ...EMPTY_FACTS }, attempts, calls };
  } catch (err) {
    // Not a provider signal: the client converts every transport error into an
    // `ok: false` result, so anything thrown here is local.
    console.error(
      `  → brand facts failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
