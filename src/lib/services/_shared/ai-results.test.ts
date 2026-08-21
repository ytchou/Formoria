import { describe, expect, it, vi } from "vitest";
import {
  mergeDescriptionAuditResponse,
  retryAuditWrite,
} from "./ai-results";

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
  it("retries a transient error and succeeds", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValueOnce({ code: "40001", message: "serialization failure" })
      .mockResolvedValueOnce(null);
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toBeNull();
    expect(write).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("gives up after three transient attempts and returns the last error", async () => {
    const error = { code: "40001", message: "serialization failure" };
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValue(error);
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toBe(error);
    expect(write).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("does not retry a terminal error", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValue({ code: "23514", message: "constraint violation" });
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toMatchObject({
      code: "23514",
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("still accepts an injected wait with the two-argument signature", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockResolvedValueOnce({ code: "40001", message: "temporary" })
      .mockResolvedValue(null);
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await retryAuditWrite(write, wait);

    expect(wait).toHaveBeenCalledTimes(1);
    const [delay] = wait.mock.calls[0] ?? [];
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThan(1_000);
  });

  it("never throws when a write rejects", async () => {
    const write = vi
      .fn<() => Promise<{ code?: string; message: string } | null>>()
      .mockRejectedValue(new Error("connection dropped"));
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(retryAuditWrite(write, wait)).resolves.toMatchObject({
      message: "connection dropped",
    });
    expect(write).toHaveBeenCalledTimes(3);
  });
});

