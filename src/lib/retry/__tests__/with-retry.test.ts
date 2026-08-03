import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "../with-retry";
import { IN_PROCESS, RETRY_ATTEMPTS } from "../policy";
import type { RetryClassification } from "../classify";

type Result = { ok: boolean; value: string };

const classify = (result: Result): RetryClassification =>
  result.ok
    ? { retryable: false, reason: "terminal" }
    : { retryable: true, reason: "network" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("returns immediately on first-try success", async () => {
    const operation = vi.fn().mockResolvedValue({ ok: true, value: "done" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(withRetry(IN_PROCESS, operation, { classify, sleep, onRetry })).resolves.toEqual({
      ok: true,
      value: "done",
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("retries a retryable result and succeeds", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, value: "temporary" })
      .mockResolvedValueOnce({ ok: true, value: "done" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(IN_PROCESS, operation, { classify, sleep })).resolves.toEqual({
      ok: true,
      value: "done",
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stops at RETRY_ATTEMPTS and returns the last result", async () => {
    const lastResult = { ok: false, value: "still failing" };
    const operation = vi.fn().mockResolvedValue(lastResult);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(IN_PROCESS, operation, { classify, sleep })).resolves.toBe(lastResult);
    expect(operation).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
  });

  it("short-circuits a terminal classification", async () => {
    const operation = vi.fn().mockResolvedValue({ ok: true, value: "terminal" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await withRetry(IN_PROCESS, operation, { classify, sleep });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports attemptIndex, reason, and delayMs on each retry", async () => {
    const operation = vi.fn().mockResolvedValue({ ok: false, value: "failed" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await withRetry(IN_PROCESS, operation, { classify, sleep, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls.map(([context]) => context.attemptIndex)).toEqual([1, 2]);
    expect(onRetry.mock.calls.map(([context]) => context.reason)).toEqual([
      "network",
      "network",
    ]);
    expect(onRetry.mock.calls.map(([context]) => context.delayMs)).toEqual(
      sleep.mock.calls.map(([delay]) => delay),
    );
  });

  it("awaits the injected sleep between attempts", async () => {
    const operation = vi.fn().mockResolvedValue({ ok: false, value: "failed" });
    let sleeping = false;
    const sleep = vi.fn(async () => {
      sleeping = true;
      await Promise.resolve();
      sleeping = false;
    });

    await withRetry(IN_PROCESS, async (attemptIndex) => {
      if (attemptIndex > 0) expect(sleeping).toBe(false);
      return operation();
    }, { classify, sleep });

    expect(sleep).toHaveBeenCalledTimes(RETRY_ATTEMPTS - 1);
  });
});
