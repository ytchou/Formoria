import {
  FACTS_SYSTEM_PROMPT,
  FOUNDING_FACTS_SYSTEM_PROMPT,
  FOUNDING_FACTS_VERIFY_SYSTEM_PROMPT,
} from "@/lib/prompts";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
} from "@/lib/prompts/shared";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { parseJson } from "./openai-client";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
  type LlmAuditContext,
} from "./llm-audit";
import { containsHan, localizeToTW } from "./taiwan-localization";
import { reportBannedTerms } from "@/lib/i18n/banned-terms";
import type { AuditCallContext } from "@/lib/audit";
import { parseExtractionResult } from "./category-classifier";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { normalizeSubcategories } from "@/lib/services/subcategories";
import { noLlmCalls, type LlmCallCounts } from "./_shared/llm-call-outcome";
import {
  evaluateFoundingFact,
  type EvaluatedFoundingFact,
  type FoundingFactClaim,
  type FoundingFactField,
  type FoundingFactSourceType,
  type FoundingLocationContext,
} from "./founding-facts";

/** Punctuation-only zh-TW normalization. Nothing here rewrites vocabulary. */
function localizeZhText(text: string): string {
  return containsHan(text) ? localizeToTW(text).text : text;
}

export type BrandFactsResult = {
  /**
   * The brand's L1 category, decided here rather than at triage because this is
   * the first call that sees the brand's own site text and its product images'
   * alt text. Undefined for an absent or unrecognised value — a made-up slug is
   * a model error, not a reason to discard the rest of the extraction.
   */
  categorySlug?: string;
  subcategories: string[];
  subcategoriesEn: string[];
  city: string | null;
  foundingYear: number | null;
  /**
   * Stage-2 listing verdict. Optional and always tolerated as absent: a missing
   * or malformed `listing` means "no opinion", which the consumer treats as
   * `list`.
   */
  listing?: ListingVerdict;
  rejected?: { subcategory: string; reason: string }[];
  rawResponse?: unknown;
};

const VALID_CATEGORY_SLUGS = new Set<string>(
  L1_CATEGORIES.map((category) => category.slug),
);

/**
 * Validates against the real L1 slug list. Anything else — absent, null, a made
 * up slug, a Chinese category name — is undefined, never a rejection.
 */
function parseDescriptionCategory(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return VALID_CATEGORY_SLUGS.has(trimmed) ? trimmed : undefined;
}

const LISTING_VERDICTS = ["list", "reject"] as const;
const TAIWAN_CONNECTIONS = [
  "created",
  "designed",
  "manufactured",
  "unclear",
] as const;

/**
 * Structured Output schema for the facts extraction call. The `category` enum
 * is derived from the live L1_CATEGORIES so a new category automatically
 * appears in the schema without a second edit.
 */
export const FACTS_SCHEMA = {
  name: "brand_facts",
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: [
      "category",
      "subcategories",
      "material",
      "city",
      "founding_year",
      "listing",
    ],
    properties: {
      category: {
        enum: [...L1_CATEGORIES.map((c) => c.slug), null],
      },
      subcategories: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      material: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      city: { type: ["string", "null"] as const },
      founding_year: { type: ["number", "null"] as const },
      listing: {
        type: "object" as const,
        additionalProperties: false,
        required: [
          "reasoning",
          "verdict",
          "reason",
          "taiwan_connection",
          "has_own_products",
          "has_purchase_channel",
        ],
        properties: {
          reasoning: { type: "string" as const },
          verdict: { type: "string" as const, enum: [...LISTING_VERDICTS] },
          reason: { type: "string" as const },
          taiwan_connection: {
            enum: [...TAIWAN_CONNECTIONS, null],
          },
          has_own_products: { type: ["boolean", "null"] as const },
          has_purchase_channel: { type: ["boolean", "null"] as const },
        },
      },
    },
  },
};

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
  subcategories: [],
  subcategoriesEn: [],
  city: null,
  foundingYear: null,
};

export function parseBrandFactsResult(content: string): BrandFactsResult {
  const parsed = parseJson<Record<string, unknown>>(content);
  if (!parsed) return { ...EMPTY_FACTS };

  // `parseExtractionResult` owns city/year/tags for every extraction call
  // in the pipeline, so the facts call reuses it rather than re-deriving the
  // city slug map a second time.
  const extraction = parseExtractionResult(content);

  // No `subcategories_en` parse. The prompt stopped asking for that key, and
  // `normalizeSubcategories` derives English from the resolved ontology node, so
  // a parsed array could only ever have been discarded.
  const normalizedSubcategories = normalizeSubcategories(
    extraction.subcategories,
  );

  const listing = parseListingVerdict(parsed.listing);
  const categorySlug = parseDescriptionCategory(parsed.category);

  const acceptedSubcategories =
    normalizedSubcategories.subcategories.length >= 1
      ? normalizedSubcategories.subcategories
      : [];
  const acceptedSubcategoriesEn =
    normalizedSubcategories.subcategories.length >= 1
      ? normalizedSubcategories.subcategoriesEn
      : [];

  return {
    ...(categorySlug ? { categorySlug } : {}),
    subcategories: acceptedSubcategories,
    subcategoriesEn: acceptedSubcategoriesEn,
    city: extraction.city,
    foundingYear: extraction.foundingYear,
    rejected: normalizedSubcategories.rejected,
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

export type FoundingFactSource = {
  url: string;
  text: string;
  sourceType: FoundingFactSourceType;
  reputable: boolean;
  fetched: boolean;
};

export type FoundingFactResearchOutput = {
  city: EvaluatedFoundingFact;
  foundingYear: EvaluatedFoundingFact;
  claims: FoundingFactClaim[];
  calls: LlmCallCounts;
};

type RawFoundingClaim = {
  field?: unknown;
  value?: unknown;
  cited_url?: unknown;
  exact_excerpt?: unknown;
  location_context?: unknown;
};

type RawVerificationResult = {
  claim_index?: unknown;
  passed?: unknown;
  reason?: unknown;
};

const FOUNDING_LOCATION_CONTEXTS = new Set<FoundingLocationContext>([
  "founding",
  "headquarters",
  "contact",
  "studio",
  "store",
  "current",
  "unclear",
]);

export const FOUNDING_FACTS_SCHEMA = {
  name: "founding_fact_claims",
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array" as const,
        items: {
          type: "object" as const,
          additionalProperties: false,
          required: [
            "field",
            "value",
            "cited_url",
            "exact_excerpt",
            "location_context",
          ],
          properties: {
            field: { enum: ["city", "founding_year"] },
            value: { type: ["string", "number"] as const },
            cited_url: { type: "string" as const },
            exact_excerpt: { type: "string" as const },
            location_context: {
              enum: [
                "founding",
                "headquarters",
                "contact",
                "studio",
                "store",
                "current",
                "unclear",
              ],
            },
          },
        },
      },
    },
  },
};

export const FOUNDING_FACTS_VERIFY_SCHEMA = {
  name: "founding_fact_verification",
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array" as const,
        items: {
          type: "object" as const,
          additionalProperties: false,
          required: ["claim_index", "passed", "reason"],
          properties: {
            claim_index: { type: "integer" as const },
            passed: { type: "boolean" as const },
            reason: { type: ["string", "null"] as const },
          },
        },
      },
    },
  },
};

function sourceKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href.replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function parseFoundingClaims(
  content: string,
  sources: readonly FoundingFactSource[],
): Array<Omit<FoundingFactClaim, "verification">> {
  const parsed = parseJson<{ claims?: RawFoundingClaim[] }>(content);
  if (!Array.isArray(parsed?.claims)) return [];
  const sourceByUrl = new Map(
    sources.flatMap((source) => {
      const key = sourceKey(source.url);
      return key ? [[key, source] as const] : [];
    }),
  );

  return parsed.claims.slice(0, 20).flatMap((raw) => {
    const field =
      raw.field === "city" || raw.field === "founding_year"
        ? (raw.field as FoundingFactField)
        : null;
    const citedUrl = typeof raw.cited_url === "string" ? raw.cited_url : "";
    const source = sourceByUrl.get(sourceKey(citedUrl) ?? "");
    const value = raw.value;
    const exactExcerpt =
      typeof raw.exact_excerpt === "string" ? raw.exact_excerpt.trim() : "";
    const locationContext = FOUNDING_LOCATION_CONTEXTS.has(
      raw.location_context as FoundingLocationContext,
    )
      ? (raw.location_context as FoundingLocationContext)
      : "unclear";
    if (
      !field ||
      !source ||
      (typeof value !== "string" && typeof value !== "number") ||
      !exactExcerpt
    ) {
      return [];
    }
    return [
      {
        field,
        value,
        citedUrl: source.url,
        exactExcerpt,
        sourceText: source.fetched ? source.text : null,
        sourceType: source.sourceType,
        reputable: source.reputable,
        locationContext,
      },
    ];
  });
}

function parseVerificationResults(
  content: string,
): Map<number, { passed: boolean; reason: string | null }> {
  const parsed = parseJson<{ results?: RawVerificationResult[] }>(content);
  const results = new Map<number, { passed: boolean; reason: string | null }>();
  for (const raw of parsed?.results ?? []) {
    if (!Number.isInteger(raw.claim_index) || typeof raw.passed !== "boolean")
      continue;
    results.set(raw.claim_index as number, {
      passed: raw.passed,
      reason: typeof raw.reason === "string" ? raw.reason : null,
    });
  }
  return results;
}

function emptyFoundingResearch(
  calls = noLlmCalls(),
): FoundingFactResearchOutput {
  return {
    city: evaluateFoundingFact("city", []),
    foundingYear: evaluateFoundingFact("founding_year", []),
    claims: [],
    calls,
  };
}

/** Runs extraction and a distinct verifier; deterministic code assigns confidence. */
export async function researchFoundingFacts(
  brandName: string,
  sources: readonly FoundingFactSource[],
  audit: Pick<LlmAuditContext, "jobId" | "target">,
): Promise<FoundingFactResearchOutput | null> {
  const token = process.env.OPENAI_API_KEY;
  if (!token || sources.length === 0) return null;
  const calls = noLlmCalls();
  const boundedSources = sources.map((source) => ({
    ...source,
    text: source.text.slice(0, 8_000),
  }));
  const extractionConfig = buildProfiledEnrichmentConfig(
    "founding_facts",
    FOUNDING_FACTS_SYSTEM_PROMPT,
    "foundingFacts",
  );
  const extraction = await createProfiledOpenAIClient(
    "foundingFacts",
    { ...audit, phase: "founding_facts", config: extractionConfig },
    { apiKey: token },
  ).chat({
    system: FOUNDING_FACTS_SYSTEM_PROMPT,
    user: JSON.stringify({ brandName, sources: boundedSources }),
    json: true,
    schema: FOUNDING_FACTS_SCHEMA,
    ...profileChatParams("foundingFacts"),
  });
  calls.attempted += 1;
  if (!extraction.response.ok) {
    calls.providerFailed += 1;
    return emptyFoundingResearch(calls);
  }
  if (!extraction.content) return emptyFoundingResearch(calls);

  const proposed = parseFoundingClaims(extraction.content, boundedSources);
  if (proposed.length === 0) return emptyFoundingResearch(calls);

  const verificationConfig = buildProfiledEnrichmentConfig(
    "founding_facts_verify",
    FOUNDING_FACTS_VERIFY_SYSTEM_PROMPT,
    "foundingFactsVerify",
  );
  const verification = await createProfiledOpenAIClient(
    "foundingFactsVerify",
    { ...audit, phase: "founding_facts_verify", config: verificationConfig },
    { apiKey: token },
  ).chat({
    system: FOUNDING_FACTS_VERIFY_SYSTEM_PROMPT,
    user: JSON.stringify({
      brandName,
      sources: boundedSources,
      claims: proposed.map((claim, claimIndex) => ({ claimIndex, ...claim })),
    }),
    json: true,
    schema: FOUNDING_FACTS_VERIFY_SCHEMA,
    ...profileChatParams("foundingFactsVerify"),
  });
  calls.attempted += 1;
  if (!verification.response.ok) calls.providerFailed += 1;
  const verified = verification.content
    ? parseVerificationResults(verification.content)
    : new Map<number, { passed: boolean; reason: string | null }>();
  const claims: FoundingFactClaim[] = proposed.map((claim, index) => ({
    ...claim,
    verification: verified.get(index) ?? {
      passed: false,
      reason: "verification result missing",
    },
  }));

  return {
    city: evaluateFoundingFact(
      "city",
      claims.filter((claim) => claim.field === "city"),
    ),
    foundingYear: evaluateFoundingFact(
      "founding_year",
      claims.filter((claim) => claim.field === "founding_year"),
    ),
    claims,
    calls,
  };
}

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
  /**
   * The enclosing phase span. REQUIRED: while it was optional, deleting the
   * threaded argument at the one call site compiled, linted, and passed the
   * whole suite with vocabulary detection silently off.
   */
  ctx: AuditCallContext,
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
  const factsSystemPrompt = await fetchLangfusePrompt(
    "brand-facts",
    FACTS_SYSTEM_PROMPT,
    {
      category_list: CATEGORY_LIST,
      subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
      material_vocab_block: MATERIAL_VOCAB_BLOCK,
    },
  );

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
        system: factsSystemPrompt,
        user: `${userContent}${retryInstruction}`,
        json: true,
        schema: FACTS_SCHEMA,
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
      // Report-only (DEV-1546), and on the ACCEPTED attempt ONLY: this return
      // is the sole exit that hands a listing verdict to a caller, so a
      // discarded earlier attempt can never contribute a hit an operator would
      // then fail to find in any row. The reason lands in
      // `triage_results.non_brand_reason`, prefixed by curation-operations.
      reportBannedTerms(ctx, [["non_brand_reason", result.listing?.reason]]);
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
