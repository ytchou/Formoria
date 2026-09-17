import { classifyHttpResponse, IN_PROCESS, withRetry } from "@/lib/retry";

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

export type CohereRerankResult = {
  results: Array<{ index: number; relevanceScore: number }>;
};

export function createCohereRerankClient(apiKey?: string) {
  const resolvedApiKey = apiKey ?? process.env.COHERE_API_KEY;

  return {
    async rerank(
      query: string,
      documents: string[],
      topN: number = 50,
    ): Promise<CohereRerankResult> {
      if (!resolvedApiKey) throw new Error("COHERE_API_KEY is not configured");

      const result = await withRetry(
        IN_PROCESS,
        async () => {
          const response = await fetch(COHERE_RERANK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resolvedApiKey}`,
            },
            body: JSON.stringify({
              model: "rerank-v3.5",
              query,
              documents,
              top_n: topN,
              return_documents: false,
            }),
          });
          return response;
        },
        {
          classify: classifyHttpResponse,
          service: "cohere",
        },
      );

      if (!result.ok) {
        const errorBody = await result.text().catch(() => "");
        throw new Error(`Cohere rerank failed: ${result.status} ${errorBody}`);
      }

      const data = (await result.json()) as {
        results?: Array<{ index: number; relevance_score: number }>;
      };
      if (!data.results || !Array.isArray(data.results)) {
        throw new Error(
          "Cohere rerank: malformed response — missing results array",
        );
      }

      return {
        results: data.results
          .map((r) => ({ index: r.index, relevanceScore: r.relevance_score }))
          .sort((a, b) => b.relevanceScore - a.relevanceScore),
      };
    },
  };
}
