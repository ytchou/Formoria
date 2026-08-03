import { describe, expect, it, vi } from "vitest";
import { mergeDescriptionAuditResponse, retryAuditWrite } from "./ai-results";

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

describe("audit persistence", () => {
  // This catches a transient Supabase/network failure making a provider failure
  // disappear from the durable audit trail after only one insert attempt.
  it("retries a transient failed write and returns the successful result", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValueOnce({ message: "fetch failed" })
      .mockResolvedValueOnce(null);
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toBeNull();
    expect(write).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
