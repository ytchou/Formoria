import { describe, expect, it } from "vitest";
import { LLM_MODELS, RETIRED_OPENAI_MODELS } from "@/lib/constants/llm-models";

describe("LLM_MODELS", () => {
  it("text_mini key resolves to gpt-4o-mini", () => {
    expect(LLM_MODELS.text_mini).toBe("gpt-4o-mini");
  });
});

describe("RETIRED_OPENAI_MODELS", () => {
  it("RETIRED_OPENAI_MODELS has no overlap with LLM_MODELS", () => {
    const live = new Set<string>(Object.values(LLM_MODELS));
    expect(RETIRED_OPENAI_MODELS.filter((model) => live.has(model))).toEqual([]);
  });
});
