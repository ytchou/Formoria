import { describe, expect, it } from "vitest";
import { LLM_MODELS } from "@/lib/constants/llm-models";

describe("LLM_MODELS", () => {
  it("text_mini key resolves to gpt-4o-mini", () => {
    expect(LLM_MODELS.text_mini).toBe("gpt-4o-mini");
  });
});
