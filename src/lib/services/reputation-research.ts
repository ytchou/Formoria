import { REPUTATION_SYSTEM_PROMPT } from "@/lib/prompts";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { auditedCall } from "@/lib/audit";
import {
  createProfiledOpenAIClient,
  profileChatParams,
  type LlmAuditContext,
} from "@/lib/services/llm-audit";
import type { ReputationSummary } from "@/lib/types/brand";
import type { LlmCallCounts } from "@/lib/services/_shared/llm-call-outcome";

type ReputationResult = {
  reputationSummary: ReputationSummary | null;
};

/**
 * One call, so the counts degenerate to 0/1 — but they are carried in the same
 * shape as every other LLM helper so the phase layer has a single rule for
 * "the provider was down" (see `llm-call-outcome.ts`). Before this, a quota
 * outage and a brand with genuinely no reputation evidence were both `null`.
 */
export type ReputationResearchOutput = {
  result: ReputationResult | null;
  calls: LlmCallCounts;
};

type ReputationInput = {
  name: string;
  description: string | null;
  category?: string | null;
  serpSnippets: string[];
  siteContent: string | null;
};

type RawProvenanceSource = {
  url?: unknown;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseSources(value: unknown): { url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as RawProvenanceSource;
    if (!isString(source.url)) return [];
    return [{ url: source.url }];
  });
}

function parseReputationSummary(value: unknown): ReputationSummary | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!isString(item.text) || item.text.trim().length === 0) return null;
  const sources = parseSources(item.sources);
  if (sources.length === 0) return null;
  return {
    text: item.text.trim(),
    textEn: isString(item.text_en) ? item.text_en.trim() : null,
    sources,
  };
}

function parseReputationResult(content: string): ReputationResult | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      reputationSummary: parseReputationSummary(parsed.reputation_summary),
    };
  } catch {
    return null;
  }
}

export async function runReputationResearch(
  input: ReputationInput,
  audit: LlmAuditContext,
): Promise<ReputationResearchOutput | null> {
  return auditedCall(
    { provider: "enrich", operation: "runReputationResearch", kind: "service" },
    async () => {
  const token = process.env.OPENAI_API_KEY;
  if (!token) return null;
  if (
    input.serpSnippets.length === 0 &&
    !input.siteContent &&
    !input.description
  )
    return null;

  const userContent = [
    `品牌名稱：${input.name}`,
    input.category ? `類別：${input.category}` : "",
    input.description ? `品牌描述：${input.description}` : "",
    input.serpSnippets.length > 0
      ? `搜尋摘要：\n${input.serpSnippets.slice(0, 10).join("\n")}`
      : "",
    input.siteContent ? `網站內容：\n${input.siteContent}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = createProfiledOpenAIClient("reputation", audit, {
    apiKey: token,
  });

  try {
    const reputationPrompt = await fetchLangfusePrompt("reputation", REPUTATION_SYSTEM_PROMPT);
    const { response, content } = await client.chat({
      system: reputationPrompt,
      user: userContent,
      json: true,
      ...profileChatParams("reputation"),
    });
    // The only provider-failure site: a non-2xx never reached the model. An
    // empty or unparseable body below is the model having answered badly, which
    // must keep leaving the phase `succeeded` — otherwise Gate C would fail
    // every brand the model simply had nothing to say about.
    if (!response.ok) {
      return { result: null, calls: { attempted: 1, providerFailed: 1 } };
    }

    if (!content)
      return { result: null, calls: { attempted: 1, providerFailed: 0 } };
    const parsed = parseReputationResult(content);
    return { result: parsed, calls: { attempted: 1, providerFailed: 0 } };
  } catch {
    // Transport failures are already returned as `ok: false` by the client, so
    // anything thrown here is local — attributed to neither side's call count.
    return null;
  }
    },
  );
}
