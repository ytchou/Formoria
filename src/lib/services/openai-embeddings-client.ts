import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
} from "@/lib/constants/llm-models";
import {
  classifyHttpResponse,
  IN_PROCESS,
  withRetry,
} from "@/lib/retry";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

type EmbeddingsClientOptions = {
  apiKey?: string;
  model?: string;
};

type EmbeddingsUsage = {
  prompt_tokens: number;
  total_tokens: number;
};

type EmbeddingsDataItem = {
  index: number;
  embedding: number[];
};

type EmbeddingsResponse = {
  data: EmbeddingsDataItem[];
  usage: EmbeddingsUsage;
  model: string;
};

export type EmbeddingsResult = {
  ok: boolean;
  vectors: number[][];
  usage: EmbeddingsUsage;
  model: string;
};

type EmbedOptions = {
  timeoutMs?: number;
};

export function createOpenAIEmbeddingsClient({
  apiKey,
  model = EMBEDDING_MODEL,
}: EmbeddingsClientOptions = {}) {
  const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY;

  function authHeaders(): Record<string, string> {
    if (!resolvedApiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    };
  }

  return {
    async embed(
      inputs: string[],
      options: EmbedOptions = {},
    ): Promise<EmbeddingsResult> {
      if (inputs.length > EMBEDDING_BATCH_SIZE) {
        throw new Error(
          `Batch size ${inputs.length} exceeds maximum ${EMBEDDING_BATCH_SIZE}`,
        );
      }

      // Resolve headers before retry so a missing key throws immediately.
      const headers = authHeaders();
      const { timeoutMs = 30_000 } = options;

      const result = await withRetry(
        IN_PROCESS,
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const response = await fetch(OPENAI_EMBEDDINGS_URL, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model,
                input: inputs,
                encoding_format: "float",
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              return { response, ok: false as const };
            }

            const data = (await response.json()) as EmbeddingsResponse;

            // Sort by index to match input order.
            const sorted = [...data.data].sort((a, b) => a.index - b.index);
            const vectors = sorted.map((item) => item.embedding);

            return {
              response,
              ok: true as const,
              vectors,
              usage: data.usage,
              model: data.model,
            };
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          classify: (r) => classifyHttpResponse(r.response),
          service: "openai-embeddings",
        },
      );

      if (!result.ok) {
        throw new Error(
          `OpenAI embeddings request failed with status ${result.response.status}`,
        );
      }

      return {
        ok: true,
        vectors: result.vectors,
        usage: result.usage,
        model: result.model,
      };
    },
  };
}
