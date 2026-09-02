import { auditedCall } from "@/lib/audit";
import { EMBEDDING_MODEL } from "@/lib/constants/llm-models";
import { priceUsage } from "./llm-pricing";
import {
  createOpenAIEmbeddingsClient,
  type EmbeddingsResult,
} from "./openai-embeddings-client";

type EmbeddingsAuditContext = {
  phase: string;
  jobId?: string;
};

type ClientOptions = {
  apiKey?: string;
  model?: string;
};

export function createAuditedEmbeddingsClient(
  context: EmbeddingsAuditContext,
  options: ClientOptions = {},
) {
  const model = options.model ?? EMBEDDING_MODEL;

  return {
    async embed(inputs: string[]): Promise<EmbeddingsResult> {
      return auditedCall(
        {
          provider: "openai",
          operation: "embeddings",
          kind: "external",
        },
        async (ctx) => {
          const client = createOpenAIEmbeddingsClient({
            ...options,
            model,
          });
          const result = await client.embed(inputs);

          if (result.usage) {
            try {
              const cost = await priceUsage(result.model ?? model, {
                prompt_tokens: result.usage.prompt_tokens,
                completion_tokens: 0,
              });
              ctx.promptTokens = cost.promptTokens;
              ctx.completionTokens = 0;
              ctx.costUsd = cost.costUsd;
            } catch {
              // Price lookup must never prevent the audit row from being written.
            }
          }

          return result;
        },
        {
          classify: (result) => (result.ok ? "succeeded" : "failed"),
          summary: { phase: context.phase },
          jobId: context.jobId ?? null,
        },
      );
    },
  };
}
