import { NAME_ARBITER_SYSTEM_PROMPT } from "@/lib/prompts";
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
  contentFailed,
  isLlmProviderFailure,
  noLlmCalls,
  notAttempted,
  providerFailed,
  type LlmCallOutcome,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import type { LlmBatchOutcome } from "./product-type-classifier";

export type NameCandidateSource = "stored" | "cleaned" | "detected" | "scraped";

export type NameCandidate = {
  source: NameCandidateSource;
  value: string;
};

export type NameArbiterItem = {
  slug: string;
  storedName: string;
  candidates: NameCandidate[];
  snippets?: string[];
  target?: EnrichmentTarget;
};

export type NameVerdict = {
  chosen: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type UnknownRecord = Record<string, unknown>;

/**
 * The verdicts are wrapped in a `results` object rather than returned as a bare
 * top-level array because `response_format: {type: "json_object"}` — which
 * `openai-client` also falls back to when a model rejects `json_schema` — makes
 * a top-level array an illegal reply. Asking for one produced an empty object on
 * every call in the 2026-08-03 DEV-1321 eval (0/26 verdicts). Never reintroduce
 * a bare-array contract here or in NAME_ARBITER_SYSTEM_PROMPT.
 */
export const NAME_ARBITRATION_SCHEMA = {
  name: "name_arbitration",
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
          required: ["slug", "chosen", "confidence", "reason"],
          properties: {
            slug: { type: "string" },
            chosen: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

/**
 * Tolerated shapes, in order: the schema-pinned `{results: [...]}`, a bare
 * array, and a bare single object. The latter two are the robustness the
 * `json_object` fallback path needs — that mode enforces "an object", not
 * "this object".
 */
function toArbiterEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const wrapped = (parsed as UnknownRecord).results;
  if (Array.isArray(wrapped)) return wrapped;

  return [parsed];
}

type NameArbiterProfileKey = Extract<LlmProfileKey, "names" | "namesBatch">;

function createNameArbiterClient(
  apiKey: string,
  profileKey: NameArbiterProfileKey,
  target: EnrichmentTarget | undefined,
  jobId?: string,
) {
  if (!target) {
    return createOpenAIClient({
      apiKey,
      model: resolveProfileModel(profileKey),
    });
  }

  // Detect/classify skip the persisted prompt config. Names deliberately joins
  // the descriptions/facts side that stores the prompt contract in its audit row.
  const config = buildProfiledEnrichmentConfig(
    "names",
    NAME_ARBITER_SYSTEM_PROMPT,
    profileKey,
  );

  return createProfiledOpenAIClient(
    profileKey,
    {
      target,
      phase: "names",
      ...(jobId ? { jobId } : {}),
      config,
    },
    { apiKey },
  );
}

function formatNameArbiterItem(item: NameArbiterItem, index: number): string {
  const candidateLine = item.candidates
    .map((candidate) => `${candidate.source}：${candidate.value}`)
    .join("；");
  const snippetLine = item.snippets?.length
    ? ` / 搜尋摘要：${item.snippets.slice(0, 10).join("；")}`
    : "";

  return `${index + 1}. [${item.slug}] 儲存名稱：${item.storedName} / 候選：${candidateLine || "無"}${snippetLine}`;
}

function buildNameArbiterUserContent(items: NameArbiterItem[]): string {
  const list = items
    .map((item, index) => formatNameArbiterItem(item, index))
    .join("\n");
  return `請裁決以下品牌的正式名稱：\n${list}`;
}

function isConfidence(value: unknown): value is NameVerdict["confidence"] {
  return value === "high" || value === "medium" || value === "low";
}

function parseNameVerdict(value: unknown): NameVerdict | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as UnknownRecord;
  const chosen = entry.chosen;
  const confidence = entry.confidence;
  if (
    typeof chosen !== "string" ||
    chosen.trim().length === 0 ||
    !isConfidence(confidence)
  ) {
    return null;
  }

  return {
    chosen: chosen.trim(),
    confidence,
    reason: typeof entry.reason === "string" ? entry.reason.trim() : "",
  };
}

function parseArbiterResponse(
  content: string,
  items: NameArbiterItem[],
): Map<string, NameVerdict> | null {
  const entries = toArbiterEntries(JSON.parse(content) as unknown);
  if (!entries) return null;

  const validSlugs = new Set(items.map((item) => item.slug));
  const results = new Map<string, NameVerdict>();

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const item = entry as UnknownRecord;
    const responseSlug = item.slug;
    // parseBatchClassification lacks this positional fallback. We deliberately
    // follow the detect side because a numbered list must survive a model that
    // omits or mangles one join key.
    const slug =
      typeof responseSlug === "string" && validSlugs.has(responseSlug)
        ? responseSlug
        : items[index]?.slug;

    if (!slug) return;

    const verdict = parseNameVerdict(item);
    if (verdict) results.set(slug, verdict);
  });

  return results;
}

function parseSingleArbiterResponse(content: string): NameVerdict | null {
  // The fan-out path sends one brand but the contract is still a `results`
  // array, so unwrap it and take the first entry.
  const entries = toArbiterEntries(JSON.parse(content) as unknown);
  return entries ? parseNameVerdict(entries.at(0)) : null;
}

async function arbitrateBrandName(
  item: NameArbiterItem,
  jobId?: string,
): Promise<LlmCallOutcome<NameVerdict>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const client = createNameArbiterClient(token, "names", item.target, jobId);

  try {
    const { response, data, content } = await client.chat({
      system: NAME_ARBITER_SYSTEM_PROMPT,
      user: buildNameArbiterUserContent([item]),
      json: true,
      schema: NAME_ARBITRATION_SCHEMA,
      ...profileChatParams("names"),
    });

    if (!response.ok) {
      console.error(`  → name arbitration failed: HTTP ${response.status}`);
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → name arbitration: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const result = parseSingleArbiterResponse(content);
    if (!result) {
      console.error(
        `  → name arbitration: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: result, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → name arbitration failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

async function arbitrateBrandNamesChunk(
  items: NameArbiterItem[],
  jobId?: string,
): Promise<LlmCallOutcome<Map<string, NameVerdict>>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const client = createNameArbiterClient(
    token,
    "namesBatch",
    items.at(0)?.target,
    jobId,
  );

  try {
    const { response, data, content } = await client.chat({
      system: NAME_ARBITER_SYSTEM_PROMPT,
      user: buildNameArbiterUserContent(items),
      json: true,
      schema: NAME_ARBITRATION_SCHEMA,
      ...profileChatParams("namesBatch"),
    });

    if (!response.ok) {
      console.error(
        `  → name arbitration batch failed: HTTP ${response.status}`,
      );
      return providerFailed();
    }

    if (!content) {
      console.error(
        `  → name arbitration batch: empty response, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      return contentFailed();
    }

    const results = parseArbiterResponse(content, items);
    if (!results) {
      console.error(
        `  → name arbitration batch: invalid response: ${content.slice(0, 200)}`,
      );
      return contentFailed();
    }

    return { value: results, calls: { attempted: 1, providerFailed: 0 } };
  } catch (err) {
    console.error(
      `  → name arbitration batch failed: ${err instanceof Error ? err.message : err}`,
    );
    return contentFailed();
  }
}

export async function arbitrateBrandNames(
  items: NameArbiterItem[],
  jobId?: string,
): Promise<LlmBatchOutcome<Map<string, NameVerdict>>> {
  return auditedCall(
    { provider: "enrich", operation: "arbitrateBrandNames", kind: "service" },
    async () => {
  const results = new Map<string, NameVerdict>();
  let calls = noLlmCalls();

  for (let i = 0; i < items.length; i += LLM_BATCH_CHUNK_SIZE) {
    const batch = items.slice(i, i + LLM_BATCH_CHUNK_SIZE);
    const chunk = await arbitrateBrandNamesChunk(batch, jobId);
    calls = addLlmCalls(calls, chunk.calls);

    if (chunk.value) {
      for (const [slug, verdict] of chunk.value) {
        results.set(slug, verdict);
      }
      continue;
    }

    // A provider-level chunk failure means the account, not the payload, is
    // the problem — on 2026-08-02, fan-out would have turned one dead batch
    // call into 20 more doomed calls per chunk. No-key pre-flight is also not
    // content failure, so it should not manufacture per-item retries.
    if (isLlmProviderFailure(chunk.calls) || chunk.calls.attempted === 0) {
      continue;
    }

    for (const item of batch) {
      const single = await arbitrateBrandName(item, jobId);
      calls = addLlmCalls(calls, single.calls);
      if (single.value) {
        results.set(item.slug, single.value);
      }
    }
  }

  return { results, calls };
    },
  );
}
