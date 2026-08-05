import { SITE_IDENTITY_LABELS, SITE_IDENTITY_SYSTEM_PROMPT } from "@/lib/prompts";
import { auditedCall } from "@/lib/audit";
import {
  LLM_BATCH_CHUNK_SIZE,
  resolveProfileModel,
  type LlmProfileKey,
} from "@/lib/constants/llm-models";
import { createOpenAIClient } from "./openai-client";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "./llm-audit";
import {
  addLlmCalls,
  isLlmProviderFailure,
  noLlmCalls,
  type LlmCallCounts,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import type { LlmBatchOutcome } from "./product-type-classifier";

export type SiteIdentitySubjectKind = "website" | "source-page";

export type SiteIdentityItem = {
  slug: string;
  brandName: string;
  productType?: string;
  subjectUrl: string;
  subjectKind: SiteIdentitySubjectKind;
  pageTitle?: string;
  pageDescription?: string;
  pageStory?: string;
  target?: EnrichmentTarget;
};

export type SiteIdentityVerdict = {
  slug: string;
  owned: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type UnknownRecord = Record<string, unknown>;

/**
 * The verdicts are wrapped in a results object instead of returned as a bare
 * top-level array because the json_object fallback rejects top-level arrays.
 * The 2026-08-03 DEV-1321 eval returned no usable verdicts for that shape
 * (0/26), so the object wrapper is part of this adapter's contract.
 */
export const SITE_IDENTITY_SCHEMA = {
  name: "site_identity",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "owned", "confidence", "reason"],
          properties: {
            slug: { type: "string" },
            owned: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

/**
 * Tolerated shapes, in order: the schema-pinned results wrapper, a bare array,
 * and a bare single object. The latter two are the robustness the
 * json_object fallback path needs — that mode enforces an object, not this object.
 */
function toArbiterEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const wrapped = (parsed as UnknownRecord).results;
  if (Array.isArray(wrapped)) return wrapped;

  return [parsed];
}

/**
 * Same local call shape as the classifier's private helper. Keeping the
 * failure boundary here preserves the classifier's batch/fallback contract
 * without making its implementation details a shared runtime dependency.
 */
type LlmCallOutcome<T> = {
  value: T | null;
  calls: LlmCallCounts;
};

/** No call was issued at all (no API key) — neither success nor provider fault. */
function notAttempted<T>(): LlmCallOutcome<T> {
  return { value: null, calls: noLlmCalls() };
}

/** The call never reached the model: non-2xx. The only thing Gate C acts on. */
function providerFailed<T>(): LlmCallOutcome<T> {
  return { value: null, calls: { attempted: 1, providerFailed: 1 } };
}

/** The provider answered; the payload was empty, unparseable or invalid. */
function contentFailed<T>(): LlmCallOutcome<T> {
  return { value: null, calls: { attempted: 1, providerFailed: 0 } };
}

type SiteIdentityProfileKey = Extract<
  LlmProfileKey,
  "siteIdentity" | "siteIdentityBatch"
>;

function createSiteIdentityClient(
  apiKey: string,
  profileKey: SiteIdentityProfileKey,
  target: EnrichmentTarget | undefined,
  jobId?: string,
) {
  if (!target) {
    return createOpenAIClient({ apiKey, model: resolveProfileModel(profileKey) });
  }
  const config = buildProfiledEnrichmentConfig(
    "site_identity",
    SITE_IDENTITY_SYSTEM_PROMPT,
    profileKey,
  );
  return createProfiledOpenAIClient(
    profileKey,
    { target, phase: "site_identity", ...(jobId ? { jobId } : {}), config },
    { apiKey },
  );
}

const SITE_IDENTITY_TEXT_LIMIT = 1200;

// Deliberately tighter than boundedScrapeSnippets' 4000 in enrich-phases/links.ts:
// a 20-item batch at 4000 crowds the profile's maxTokens.
function boundSiteIdentityText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= SITE_IDENTITY_TEXT_LIMIT
    ? value
    : value.slice(0, SITE_IDENTITY_TEXT_LIMIT) + "…";
}

function formatSiteIdentityItem(item: SiteIdentityItem, index: number): string {
  const fields = [
    SITE_IDENTITY_LABELS.brandName + "：" + item.brandName,
    item.productType
      ? SITE_IDENTITY_LABELS.productType + "：" + item.productType
      : "",
    SITE_IDENTITY_LABELS.subjectKind[item.subjectKind],
    SITE_IDENTITY_LABELS.url + "：" + item.subjectUrl,
    item.pageTitle
      ? SITE_IDENTITY_LABELS.title + "：" + boundSiteIdentityText(item.pageTitle)
      : "",
    item.pageDescription
      ? SITE_IDENTITY_LABELS.description +
        "：" +
        boundSiteIdentityText(item.pageDescription)
      : "",
    item.pageStory
      ? SITE_IDENTITY_LABELS.story + "：" + boundSiteIdentityText(item.pageStory)
      : "",
  ].filter(Boolean);

  return String(index + 1) + ". [" + item.slug + "] " + fields.join(" / ");
}

function buildSiteIdentityUserContent(items: SiteIdentityItem[]): string {
  const list = items
    .map((item, index) => formatSiteIdentityItem(item, index))
    .join("\n");
  return SITE_IDENTITY_LABELS.userPreamble + "\n" + list;
}

function isConfidence(value: unknown): value is SiteIdentityVerdict["confidence"] {
  return value === "high" || value === "medium" || value === "low";
}

function parseSiteIdentityVerdict(
  value: unknown,
  resolvedSlug: string,
): SiteIdentityVerdict | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as UnknownRecord;
  if (typeof entry.owned !== "boolean" || !isConfidence(entry.confidence)) {
    return null;
  }

  return {
    slug: resolvedSlug,
    owned: entry.owned,
    confidence: entry.confidence,
    reason: typeof entry.reason === "string" ? entry.reason.trim() : "",
  };
}

function resolveSiteIdentityItem(
  entry: UnknownRecord,
  index: number,
  items: SiteIdentityItem[],
): SiteIdentityItem | undefined {
  const responseSlug = entry.slug;
  const positional = items[index];

  if (
    positional &&
    typeof responseSlug === "string" &&
    positional.slug === responseSlug
  ) {
    return positional;
  }

  if (typeof responseSlug === "string") {
    const matches = items.filter((item) => item.slug === responseSlug);
    if (matches.length === 1) return matches[0];
  }

  return positional;
}

function parseSiteIdentityResponse(
  content: string,
  items: SiteIdentityItem[],
): Map<string, SiteIdentityVerdict> | null {
  const entries = toArbiterEntries(JSON.parse(content) as unknown);
  if (!entries) return null;

  const results = new Map<string, SiteIdentityVerdict>();
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const resolvedItem = resolveSiteIdentityItem(
      entry as UnknownRecord,
      index,
      items,
    );
    if (!resolvedItem) return;

    const verdict = parseSiteIdentityVerdict(entry, resolvedItem.slug);
    if (verdict) {
      results.set(
        siteIdentityKey(resolvedItem.slug, resolvedItem.subjectUrl),
        verdict,
      );
    }
  });

  return results;
}

export function siteIdentityKey(slug: string, subjectUrl: string): string {
  return slug + " " + subjectUrl;
}

async function arbitrateSiteIdentityItem(
  item: SiteIdentityItem,
  jobId?: string,
): Promise<LlmCallOutcome<SiteIdentityVerdict>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const client = createSiteIdentityClient(token, "siteIdentity", item.target, jobId);

  try {
    const { response, data, content } = await client.chat({
      system: SITE_IDENTITY_SYSTEM_PROMPT,
      user: buildSiteIdentityUserContent([item]),
      json: true,
      schema: SITE_IDENTITY_SCHEMA,
      ...profileChatParams("siteIdentity"),
    });

    if (!response.ok) {
      console.error("  → site identity arbitration failed: HTTP " + response.status);
      return providerFailed();
    }

    if (!content) {
      console.error(
        "  → site identity arbitration: empty response, data=" +
          JSON.stringify(data).slice(0, 200),
      );
      return contentFailed();
    }

    const result = parseSiteIdentityResponse(content, [item]);
    const verdict = result?.values().next().value as SiteIdentityVerdict | undefined;
    if (!verdict) {
      console.error(
        "  → site identity arbitration: invalid response: " + content.slice(0, 200),
      );
      return contentFailed();
    }

    return { value: verdict, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      "  → site identity arbitration failed: " +
        (err instanceof Error ? err.message : err),
    );
    return contentFailed();
  }
}

async function arbitrateSiteIdentityChunk(
  items: SiteIdentityItem[],
  jobId?: string,
): Promise<LlmCallOutcome<Map<string, SiteIdentityVerdict>>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const client = createSiteIdentityClient(
    token,
    "siteIdentityBatch",
    items.at(0)?.target,
    jobId,
  );

  try {
    const { response, data, content } = await client.chat({
      system: SITE_IDENTITY_SYSTEM_PROMPT,
      user: buildSiteIdentityUserContent(items),
      json: true,
      schema: SITE_IDENTITY_SCHEMA,
      ...profileChatParams("siteIdentityBatch"),
    });

    if (!response.ok) {
      console.error(
        "  → site identity arbitration batch failed: HTTP " + response.status,
      );
      return providerFailed();
    }

    if (!content) {
      console.error(
        "  → site identity arbitration batch: empty response, data=" +
          JSON.stringify(data).slice(0, 200),
      );
      return contentFailed();
    }

    const results = parseSiteIdentityResponse(content, items);
    if (!results) {
      console.error(
        "  → site identity arbitration batch: invalid response: " +
          content.slice(0, 200),
      );
      return contentFailed();
    }

    return { value: results, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      "  → site identity arbitration batch failed: " +
        (err instanceof Error ? err.message : err),
    );
    return contentFailed();
  }
}

export async function arbitrateSiteIdentity(
  items: SiteIdentityItem[],
  jobId?: string,
): Promise<LlmBatchOutcome<Map<string, SiteIdentityVerdict>>> {
  return auditedCall(
    { provider: "enrich", operation: "arbitrateSiteIdentity", kind: "service" },
    async () => {
      const results = new Map<string, SiteIdentityVerdict>();
      let calls = noLlmCalls();

      for (let i = 0; i < items.length; i += LLM_BATCH_CHUNK_SIZE) {
        const batch = items.slice(i, i + LLM_BATCH_CHUNK_SIZE);
        const chunk = await arbitrateSiteIdentityChunk(batch, jobId);
        calls = addLlmCalls(calls, chunk.calls);

        if (chunk.value) {
          for (const [key, verdict] of chunk.value) {
            results.set(key, verdict);
          }
          continue;
        }

        // A provider-level chunk failure means the account, not the payload, is
        // the problem — fan-out would turn one dead batch call into more doomed
        // calls per chunk. No-key pre-flight is also not content failure.
        if (isLlmProviderFailure(chunk.calls) || chunk.calls.attempted === 0) {
          continue;
        }

        for (const item of batch) {
          const single = await arbitrateSiteIdentityItem(item, jobId);
          calls = addLlmCalls(calls, single.calls);
          if (single.value) {
            results.set(siteIdentityKey(item.slug, item.subjectUrl), single.value);
          }
        }
      }

      return { results, calls };
    },
  );
}
