import { NAME_ARBITER_SYSTEM_PROMPT } from "@/lib/prompts";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
import {
  LLM_BATCH_CHUNK_SIZE,
  type LlmProfileKey,
} from "@/lib/constants/llm-models";
import { z } from "zod";
import {
  parseAndValidate,
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
import type { BrandNameEvidence } from "@/lib/types/enriched-data";

type NameCandidateSource =
  | "stored"
  | "cleaned"
  | "detected"
  | "scraped"
  | BrandNameEvidence["source"];

export type NameCandidate = {
  source: NameCandidateSource;
  value: string;
  evidence?: BrandNameEvidence[];
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

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for both validation and wire format
// ---------------------------------------------------------------------------

const confidenceShape = z.enum(["high", "medium", "low"]);

export const nameVerdictItemShape = z.object({
  slug: z.string(),
  chosen: z.string(),
  confidence: confidenceShape,
  reason: z.string(),
});

export const nameArbitrationShape = z.object({
  results: z.array(nameVerdictItemShape),
});

/**
 * The verdicts are wrapped in a `results` object rather than returned as a bare
 * top-level array because `response_format: {type: "json_object"}` — which
 * `openai-client` also falls back to when a model rejects `json_schema` — makes
 * a top-level array an illegal reply. Asking for one produced an empty object on
 * every call in the 2026-08-03 DEV-1321 eval (0/26 verdicts). Never reintroduce
 * a bare-array contract here or in NAME_ARBITER_SYSTEM_PROMPT.
 */
const NAME_ARBITRATION_SCHEMA = {
  name: "name_arbitration",
  schema: toStrictJsonSchema(nameArbitrationShape),
};

// Lenient wrapper for batch parsing — validates structure, not item contents.
const batchParseShape = z.object({
  results: z.array(z.unknown()),
});

type NameArbiterProfileKey = Extract<LlmProfileKey, "names" | "namesBatch">;

function createNameArbiterClient(
  apiKey: string,
  profileKey: NameArbiterProfileKey,
  target: EnrichmentTarget | undefined,
  jobId?: string,
) {
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
    .map((candidate) => {
      const evidence = candidate.evidence
        ?.map(
          (entry) =>
            `${entry.source} ${entry.url} observed=${JSON.stringify(entry.observedName)}`,
        )
        .join(", ");
      return `${candidate.source}：${candidate.value}${evidence ? `（${evidence}）` : ""}`;
    })
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

function parseNameVerdict(value: unknown): NameVerdict | null {
  const result = nameVerdictItemShape.safeParse(value);
  if (!result.success) return null;

  const chosen = result.data.chosen.trim();
  if (chosen.length === 0) return null;

  return {
    chosen,
    confidence: result.data.confidence,
    reason: result.data.reason.trim(),
  };
}

function normalizedCandidateValue(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, "");
}

function verdictSelectsSuppliedCandidate(
  verdict: NameVerdict,
  item: NameArbiterItem,
): boolean {
  const chosen = normalizedCandidateValue(verdict.chosen);
  return item.candidates.some(
    (candidate) => normalizedCandidateValue(candidate.value) === chosen,
  );
}

function parseArbiterResponse(
  content: string,
  items: NameArbiterItem[],
): Map<string, NameVerdict> | null {
  const parsed = parseAndValidate(content, batchParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → name arbiter batch validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }

  const validSlugs = new Set(items.map((item) => item.slug));
  const results = new Map<string, NameVerdict>();

  parsed.data.results.forEach((entry, index) => {
    const validated = nameVerdictItemShape.safeParse(entry);
    if (!validated.success) return;

    const chosen = validated.data.chosen.trim();
    if (chosen.length === 0) return;

    const verdict: NameVerdict = {
      chosen,
      confidence: validated.data.confidence,
      reason: validated.data.reason.trim(),
    };

    // parseBatchClassification lacks this positional fallback. We deliberately
    // follow the detect side because a numbered list must survive a model that
    // omits or mangles one join key.
    const slug = validSlugs.has(validated.data.slug)
      ? validated.data.slug
      : items[index]?.slug;

    if (!slug) return;

    const requestedItem = items.find((candidate) => candidate.slug === slug);
    if (
      requestedItem &&
      verdictSelectsSuppliedCandidate(verdict, requestedItem)
    ) {
      results.set(slug, verdict);
    }
  });

  return results;
}

function parseSingleArbiterResponse(
  content: string,
  item: NameArbiterItem,
): NameVerdict | null {
  // The fan-out path sends one brand but the contract is still a `results`
  // array, so unwrap it and take the first entry.
  const parsed = parseAndValidate(content, batchParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → name arbiter validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }
  const verdict = parseNameVerdict(parsed.data.results.at(0));
  return verdict && verdictSelectsSuppliedCandidate(verdict, item)
    ? verdict
    : null;
}

async function arbitrateBrandName(
  item: NameArbiterItem,
  jobId?: string,
): Promise<LlmCallOutcome<NameVerdict>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  const client = createNameArbiterClient(token, "names", item.target, jobId);

  try {
    const nameArbiterPrompt = await fetchLangfusePrompt("name-arbiter", NAME_ARBITER_SYSTEM_PROMPT);
    const { response, data, content } = await client.chat({
      system: nameArbiterPrompt,
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

    const result = parseSingleArbiterResponse(content, item);
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
    const nameArbiterBatchPrompt = await fetchLangfusePrompt("name-arbiter", NAME_ARBITER_SYSTEM_PROMPT);
    const { response, data, content } = await client.chat({
      system: nameArbiterBatchPrompt,
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
