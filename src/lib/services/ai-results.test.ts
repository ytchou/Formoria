import { describe, expect, it } from "vitest";
import { mergeDescriptionAuditResponse } from "./ai-results";

describe("description audit results", () => {
  it("preserves the model response and adds validation outcomes for a rejected description", () => {
    const rawResponse = {
      provider: "deepseek",
      ok: true,
      status: 200,
      response: {
        choices: [
          { message: { content: '{"description_zh":"價格為 NT$999"}' } },
        ],
      },
      usage: { total_tokens: 180 },
    };
    const parsed = {
      description_zh: "價格為 NT$999",
      description_en: null,
    };
    const validationRejections = [
      {
        field: "description_zh",
        reasons: ["pricing_information"],
        warnings: [],
        attempt: 1,
      },
    ];

    expect(
      mergeDescriptionAuditResponse(rawResponse, parsed, validationRejections),
    ).toEqual({
      ...rawResponse,
      parsed,
      validationRejections,
    });
  });
});
