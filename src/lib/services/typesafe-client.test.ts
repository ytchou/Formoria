import { afterEach, describe, expect, it, vi } from "vitest";
import { JEV_MODEL } from "@/lib/constants/llm-models";
import {
  createTypesafeClient,
  TypesafeApiError,
  type JevQuestion,
} from "./typesafe-client";

afterEach(() => {
  vi.unstubAllEnvs();
});

const questions: Record<string, JevQuestion> = {
  isNonBrand: {
    type: "noul",
    instructions: "Is this entity something other than a consumer brand?",
  },
  category: {
    type: "choice",
    instructions: "Which category fits the brand best?",
    criteria: { food: "Food and drink", home: "Home goods" },
  },
};
const state = { name: "Example", description: "A Taiwanese tea brand" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okBody() {
  return {
    model: JEV_MODEL,
    answers: {
      isNonBrand: { noul: 0.12 },
      category: {
        choice: "food",
        probabilities: { food: 0.91, home: 0.09 },
        confidence: 0.91,
      },
    },
    usage: { input_tokens: 120, output_tokens: 7 },
  };
}

/** A sleep that resolves immediately, so the backoff ladder costs no wall time. */
const noSleep = vi.fn(async () => {});

describe("createTypesafeClient", () => {
  it("builds request body with pinned model, state and questions", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(okBody()));
    const client = createTypesafeClient({ apiKey: "ts-key", fetch: fetchFn });

    await client.decide({ state, questions });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ts-key",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "jev-1.13.0",
      state,
      questions,
    });
  });

  it("returns answers, usage and latency on 200", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(okBody()));
    const client = createTypesafeClient({ apiKey: "ts-key", fetch: fetchFn });

    const result = await client.decide({ state, questions });

    expect(result.answers).toEqual(okBody().answers);
    expect(result.usage.input_tokens).toBe(120);
    expect(result.usage.output_tokens).toBe(7);
    expect(result.model).toBe(JEV_MODEL);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each([401, 422])(
    "fails fast on %i without retry",
    async (status) => {
      const body = { error: { message: `status ${status}` } };
      const fetchFn = vi.fn(async () => jsonResponse(body, status));
      const client = createTypesafeClient({
        apiKey: "ts-key",
        fetch: fetchFn,
        sleep: noSleep,
      });

      const error = await client
        .decide({ state, questions })
        .catch((thrown: unknown) => thrown);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(TypesafeApiError);
      expect((error as TypesafeApiError).status).toBe(status);
      expect((error as TypesafeApiError).body).toEqual(body);
      expect((error as Error).message).toContain(String(status));
    },
  );

  it.each([429, 529])("retries %i then succeeds", async (status) => {
    const fetchFn = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, status))
      .mockResolvedValueOnce(jsonResponse(okBody()));
    const sleep = vi.fn(async () => {});
    const client = createTypesafeClient({
      apiKey: "ts-key",
      fetch: fetchFn,
      sleep,
    });

    const result = await client.decide({ state, questions });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.answers).toEqual(okBody().answers);
  });

  it("throws when TYPESAFE_API_KEY is missing", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchFn = vi.fn(async () => jsonResponse(okBody()));
    const client = createTypesafeClient({ fetch: fetchFn });

    await expect(client.decide({ state, questions })).rejects.toThrow(
      "TYPESAFE_API_KEY is not configured",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
