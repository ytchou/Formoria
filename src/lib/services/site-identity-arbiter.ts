import { SITE_IDENTITY_LABELS, SITE_IDENTITY_SYSTEM_PROMPT } from "@/lib/prompts";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
import {
  LLM_BATCH_CHUNK_SIZE,
  type LlmProfileKey,
} from "@/lib/constants/llm-models";
import { z } from "zod";
import {
  parseBatchEntries,
  toStrictJsonSchema,
  formatRetryInstruction,
} from "./_shared/zod-schema";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "./llm-audit";
import {
  addLlmCalls,
  contentFailed,
  isLlmProviderFailure,
  noLlmCalls,
  notAttempted,
  providerFailed,
  type LlmCallOutcome,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import type { LlmBatchOutcome } from "./category-classifier";

export type SiteIdentitySubjectKind = "website" | "source-page";

export type SiteIdentityItem = {
  slug: string;
  brandName: string;
  categorySlug?: string;
  subjectUrl: string;
  subjectKind: SiteIdentitySubjectKind;
  pageTitle?: string;
  pageDescription?: string;
  pageStory?: string;
  target?: EnrichmentTarget;
  acquisitionBelief?: { class: string; reason: string };
};

export type SiteIdentityVerdict = {
  slug: string;
  owned: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type UnknownRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for both validation and wire format
// ---------------------------------------------------------------------------

const confidenceShape = z.enum(["high", "medium", "low"]);

export const siteIdentityVerdictItemShape = z.object({
  slug: z.string(),
  subjectUrl: z.string(),
  owned: z.boolean(),
  confidence: confidenceShape,
  reason: z.string(),
});

export const siteIdentityShape = z.object({
  results: z.array(siteIdentityVerdictItemShape),
});

/**
 * The verdicts are wrapped in a results object instead of returned as a bare
 * top-level array because the json_object fallback rejects top-level arrays.
 * The 2026-08-03 DEV-1321 eval returned no usable verdicts for that shape
 * (0/26), so the object wrapper is part of this adapter's contract.
 */
const SITE_IDENTITY_SCHEMA = {
  name: "site_identity",
  schema: toStrictJsonSchema(siteIdentityShape),
};

// Lenient wrapper for batch parsing — validates structure, not item contents.
const batchParseShape = z.object({
  results: z.array(z.unknown()),
});

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
// Caps total evidence per item; raise only with a larger model context budget.
const SITE_IDENTITY_ITEM_TEXT_BUDGET = 1800;
// Bounds recovery calls per chunk; raise only after provider-cost telemetry confirms it is safe.
const SITE_IDENTITY_MAX_FANOUT_PER_CHUNK = 8;

// Deliberately tighter than boundedScrapeSnippets' 4000 in enrich-phases/links.ts:
// a 20-item batch at 4000 crowds the profile's maxTokens.
function boundSiteIdentityText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= SITE_IDENTITY_TEXT_LIMIT
    ? value
    : value.slice(0, SITE_IDENTITY_TEXT_LIMIT) + "…";
}

function formatSiteIdentityItem(item: SiteIdentityItem, index: number): string {
  let remaining = SITE_IDENTITY_ITEM_TEXT_BUDGET;
  const bounded = (value: string | undefined): string | undefined => {
    if (!value || remaining <= 0) return undefined;
    const result = boundSiteIdentityText(value)?.slice(0, remaining);
    remaining -= result?.length ?? 0;
    return result;
  };
  const title = bounded(item.pageTitle);
  const description = bounded(item.pageDescription);
  const story = bounded(item.pageStory);
  const fields = [
    SITE_IDENTITY_LABELS.brandName + "：" + item.brandName,
    item.categorySlug
      ? SITE_IDENTITY_LABELS.categorySlug + "：" + item.categorySlug
      : "",
    SITE_IDENTITY_LABELS.subjectKind[item.subjectKind],
    SITE_IDENTITY_LABELS.url + "：" + item.subjectUrl,
    title
      ? SITE_IDENTITY_LABELS.title + "：" + title
      : "",
    description
      ? SITE_IDENTITY_LABELS.description +
        "：" +
        description
      : "",
    story
      ? SITE_IDENTITY_LABELS.story + "：" + story
      : "",
    item.acquisitionBelief
      ? "Acquisition agent believed: " + item.acquisitionBelief.class + " — " + item.acquisitionBelief.reason
      : "",
  ].filter(Boolean);

  return String(index + 1) + ". [" + item.slug + "] " + fields.join(" / ");
}

export function buildSiteIdentityUserContent(items: SiteIdentityItem[]): string {
  const list = items
    .map((item, index) => formatSiteIdentityItem(item, index))
    .join("\n");
  return SITE_IDENTITY_LABELS.userPreamble + "\n" + list;
}

function parseSiteIdentityVerdict(
  value: unknown,
  resolvedSlug: string,
): SiteIdentityVerdict | null {
  const result = siteIdentityVerdictItemShape.safeParse(value);
  if (!result.success) return null;

  return {
    slug: resolvedSlug,
    owned: result.data.owned,
    confidence: result.data.confidence,
    reason: result.data.reason.trim(),
  };
}

/**
 * Joins one response entry back to the item it answers. The join key is
 * `slug + subjectUrl`: a brand can escalate both a `website` subject and a
 * `source-page` subject, so two items share a slug and a slug-only match would
 * key a "not owned / high" verdict to the wrong subject — revoking the clean
 * column and releasing the contaminated one.
 */
function resolveSiteIdentityItem(
  entry: UnknownRecord,
  items: SiteIdentityItem[],
): SiteIdentityItem | undefined {
  const responseSlug = entry.slug;
  const responseSubjectUrl = entry.subjectUrl;

  const normaliseSubjectUrl = (value: string): string => {
    try {
      const url = new URL(value.trim());
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      url.hash = "";
      url.pathname = url.pathname.replace(/\/$/, "");
      return url.toString();
    } catch {
      return value.trim().toLowerCase();
    }
  };

  if (typeof responseSubjectUrl === "string" && responseSubjectUrl.trim()) {
    const matches = items.filter(
      (item) => normaliseSubjectUrl(item.subjectUrl) === normaliseSubjectUrl(responseSubjectUrl),
    );
    if (matches.length === 1 && (typeof responseSlug !== "string" || matches[0].slug === responseSlug)) {
      return matches[0];
    }
    // The echo was unusable (mangled, or the model copied the placeholder from
    // the prompt's examples). Fall through to the slug rule, which only
    // resolves when the slug names exactly one item and so cannot mis-key.
  }

  // Positional order is only trustworthy when the slug it carries is
  // unambiguous, which is exactly the case the slug match above already
  // resolves — so there is no separate positional fallback.
  if (typeof responseSlug === "string") {
    const matches = items.filter((item) => item.slug === responseSlug);
    if (matches.length === 1) return matches[0];
  }

  // Dropping an unresolved verdict releases; that is the safe direction.
  return undefined;
}

function parseSiteIdentityResponse(
  content: string,
  items: SiteIdentityItem[],
): Map<string, SiteIdentityVerdict> | null {
  const parsed = parseBatchEntries(content, batchParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → site identity batch validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }

  const results = new Map<string, SiteIdentityVerdict>();
  parsed.entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;

    const resolvedItem = resolveSiteIdentityItem(entry as UnknownRecord, items);
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
    const siteIdentityPrompt = await fetchLangfusePrompt("site-identity", SITE_IDENTITY_SYSTEM_PROMPT);
    const { response, data, content } = await client.chat({
      system: siteIdentityPrompt,
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
    const siteIdentityBatchPrompt = await fetchLangfusePrompt("site-identity", SITE_IDENTITY_SYSTEM_PROMPT);
    const { response, data, content } = await client.chat({
      system: siteIdentityBatchPrompt,
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
        }

        // A provider-level chunk failure means the account, not the payload, is
        // the problem — fan-out would turn one dead batch call into more doomed
        // calls per chunk. No-key pre-flight is also not content failure.
        if (isLlmProviderFailure(chunk.calls) || chunk.calls.attempted === 0) {
          continue;
        }

        // The bound applies to the UNANSWERED items, not to the first N of the
        // batch: a chunk that answered items 1-12 and dropped 13-20 would
        // otherwise spend its whole allowance re-checking answered items and
        // recover none of the missing ones.
        const unanswered = batch.filter(
          (item) => !results.has(siteIdentityKey(item.slug, item.subjectUrl)),
        );
        for (const item of unanswered.slice(0, SITE_IDENTITY_MAX_FANOUT_PER_CHUNK)) {
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
