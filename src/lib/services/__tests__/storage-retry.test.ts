import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadWithRetry } from "../storage-retry";

type StorageResult = {
  data: { path: string } | null;
  error: { statusCode?: number; message: string } | null;
};

async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = run();
  await vi.runAllTimersAsync();
  return promise;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("uploadWithRetry", () => {
  it("retries a transient storage error", async () => {
    const upload = vi
      .fn<() => Promise<StorageResult>>()
      .mockResolvedValueOnce({ data: null, error: { statusCode: 503, message: "busy" } })
      .mockResolvedValue({ data: { path: "brands/maria-garcia/photo.webp" }, error: null });

    const result = await withFakeTimers(() => uploadWithRetry(upload));

    expect(upload).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      data: { path: "brands/maria-garcia/photo.webp" },
      error: null,
    });
  });

  it("does not retry a terminal storage error", async () => {
    const failure = { data: null, error: { statusCode: 400, message: "bad payload" } };
    const upload = vi.fn<() => Promise<StorageResult>>().mockResolvedValue(failure);

    const result = await uploadWithRetry(upload);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result).toBe(failure);
  });

  it("gives up after three attempts", async () => {
    const failure = { data: null, error: { statusCode: 503, message: "busy" } };
    const upload = vi.fn<() => Promise<StorageResult>>().mockResolvedValue(failure);

    const result = await withFakeTimers(() => uploadWithRetry(upload));

    expect(upload).toHaveBeenCalledTimes(3);
    expect(result).toBe(failure);
  });

  it("returns the Storage result shape unchanged", async () => {
    const resultShape = {
      data: { path: "claim-proofs/maria-garcia/evidence.jpg" },
      error: null,
    } satisfies StorageResult;
    const upload = vi.fn<() => Promise<StorageResult>>().mockResolvedValue(resultShape);

    await expect(uploadWithRetry(upload)).resolves.toBe(resultShape);
  });
});
