import { fetchLangfusePromptWithMeta } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
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
  contentFailed,
  notAttempted,
  providerFailed,
  type LlmCallOutcome,
} from "./_shared/llm-call-outcome";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
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

const nameVerdictItemShape = z.object({
  slug: z.string(),
  chosen: z.string(),
  confidence: confidenceShape,
  reason: z.string(),
});

export const nameArbitrationShape = z.object({
  results: z.array(nameVerdictItemShape),
});

/**
 * One call judges one brand (DEV-1886), but the wire contract is still a
 * `results` array holding that one verdict: the `name-arbiter` Langfuse prompt
 * asks for exactly that shape, and changing it means a prompt version bump.
 *
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

// Lenient wrapper — validates the `results` envelope, not the verdict inside it.
const resultsParseShape = z.object({
  results: z.array(z.unknown()),
});

function createNameArbiterClient(
  apiKey: string,
  target: EnrichmentTarget | undefined,
  jobId?: string,
  prompt?: { name: string; version: number; source: "langfuse" | "snapshot" },
) {
  const config = buildProfiledEnrichmentConfig("names", "names");

  return createProfiledOpenAIClient(
    "names",
    {
      target,
      phase: "names",
      ...(jobId ? { jobId } : {}),
      ...(prompt ? { prompt } : {}),
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

/** Exported so golden-eval inputs are rendered by the same bytes production sends. */
export function buildNameArbiterUserContent(items: NameArbiterItem[]): string {
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

function parseSingleArbiterResponse(
  content: string,
  item: NameArbiterItem,
): NameVerdict | null {
  // One brand per call, but the contract is still a `results` array, so unwrap
  // it and take the first entry.
  const parsed = parseBatchEntries(content, resultsParseShape);
  if (!parsed.success) {
    if (parsed.issues) {
      console.error(`  → name arbiter validation: ${formatRetryInstruction(parsed.issues)}`);
    }
    return null;
  }
  const verdict = parseNameVerdict(parsed.entries.at(0));
  return verdict && verdictSelectsSuppliedCandidate(verdict, item)
    ? verdict
    : null;
}

/** One name-arbiter call for one brand (DEV-1886). */
export async function arbitrateBrandName(
  item: NameArbiterItem,
  jobId?: string,
): Promise<LlmCallOutcome<NameVerdict>> {
  return auditedCall(
    { provider: "enrich", operation: "arbitrateBrandName", kind: "service" },
    () => arbitrateBrandNameCall(item, jobId),
  );
}

async function arbitrateBrandNameCall(
  item: NameArbiterItem,
  jobId?: string,
): Promise<LlmCallOutcome<NameVerdict>> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return notAttempted();

  try {
    const { text: nameArbiterPrompt, prompt: namePromptMeta } = await fetchLangfusePromptWithMeta("name-arbiter");

    const client = createNameArbiterClient(token, item.target, jobId, namePromptMeta);

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
