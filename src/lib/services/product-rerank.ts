/**
 * LLM-based reranking for retrieval evaluation.
 *
 * Calls the `rerank` profile via `createProfiledOpenAIClient` and returns
 * candidates reordered by the model's ranking. Falls back to input order
 * on any schema validation failure.
 */

import { z } from "zod";
import { createProfiledOpenAIClient, profileChatParams } from "./llm-audit";
import { parseAndValidate, toStrictJsonSchema } from "./_shared/zod-schema";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const RerankResponseSchema = z.object({
  ranking: z.array(z.string()),
});

const RERANK_JSON_SCHEMA = {
  name: "rerank_response",
  schema: toStrictJsonSchema(RerankResponseSchema),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RerankCandidate = {
  id: string;
  document: string;
};

type ChatFn = {
  chat: (input: {
    system: string;
    user: string;
    schema?: { name: string; schema: Record<string, unknown> };
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ ok: boolean; content: string | null }>;
};

// ---------------------------------------------------------------------------
// Rerank
// ---------------------------------------------------------------------------

/**
 * Rerank candidates against a query using the LLM rerank profile.
 *
 * @param query     The user's situation query
 * @param candidates Up to 20 candidates with id + document text
 * @param deps      Injected chat client (for testing); defaults to the profiled client
 * @returns         Candidates reordered by the model's ranking
 */
export async function rerankProducts(
  query: string,
  candidates: RerankCandidate[],
  deps?: ChatFn,
): Promise<RerankCandidate[]> {
  if (candidates.length === 0) return [];

  const client =
    deps ??
    createProfiledOpenAIClient("rerank", {
      phase: "rerank",
    });

  const profile = profileChatParams("rerank");

  const system = [
    "You are a product relevance ranker for a Taiwanese product discovery platform.",
    "Given a user query describing a situation or need, rank the candidate products by relevance.",
    "Return a JSON object with a `ranking` array of product IDs, most relevant first.",
    "Include only the IDs that are relevant. Omit irrelevant products.",
  ].join("\n");

  const candidateList = candidates
    .map((c) => `- ID: ${c.id}\n  ${c.document}`)
    .join("\n");

  const user = `Query: ${query}\n\nCandidates:\n${candidateList}`;

  try {
    const result = await client.chat({
      system,
      user,
      schema: RERANK_JSON_SCHEMA,
      json: true,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
    });

    if (!result.ok || !result.content) {
      return [...candidates];
    }

    const parsed = parseAndValidate(result.content, RerankResponseSchema);
    if (!parsed.success) {
      return [...candidates];
    }

    // Reorder: ranked ids first, then any candidates not mentioned (in original order)
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const ranked: RerankCandidate[] = [];
    const seen = new Set<string>();

    for (const id of parsed.data.ranking) {
      const candidate = candidateMap.get(id);
      if (candidate && !seen.has(id)) {
        ranked.push(candidate);
        seen.add(id);
      }
    }

    // Append unranked candidates in original order
    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        ranked.push(candidate);
      }
    }

    return ranked;
  } catch {
    // Any unexpected error: fall back to input order
    return [...candidates];
  }
}
