import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelay } from "../backoff";
import { IN_PROCESS, JOB_REQUEUE } from "../policy";

describe("computeBackoffDelay", () => {
  it("grows exponentially from the base", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(computeBackoffDelay(IN_PROCESS, 0)).toBeGreaterThanOrEqual(500);
    expect(computeBackoffDelay(IN_PROCESS, 0)).toBeLessThan(1_000);
    expect(computeBackoffDelay(IN_PROCESS, 1)).toBeGreaterThanOrEqual(1_000);
    expect(computeBackoffDelay(IN_PROCESS, 1)).toBeLessThan(2_000);
  });

  it("saturates at the cap", () => {
    expect(computeBackoffDelay(IN_PROCESS, 20)).toBeLessThanOrEqual(8_000);
  });

  it("treats Retry-After as a floor", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const delay = computeBackoffDelay(IN_PROCESS, 0, 5_000);

    expect(delay).toBeGreaterThanOrEqual(5_000);
    expect(delay).toBeLessThanOrEqual(5_500);
  });

  it("never returns a negative or NaN delay", () => {
    const invalidRetryAfterValues = [0, -1, Number.NaN];

    for (let attemptIndex = 0; attemptIndex <= 20; attemptIndex += 1) {
      expect(computeBackoffDelay(IN_PROCESS, attemptIndex)).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(computeBackoffDelay(IN_PROCESS, attemptIndex))).toBe(true);
    }
    for (const retryAfterMs of invalidRetryAfterValues) {
      expect(Number.isFinite(computeBackoffDelay(IN_PROCESS, 0, retryAfterMs))).toBe(true);
      expect(computeBackoffDelay(IN_PROCESS, 0, retryAfterMs)).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses the minute-scale curve for job requeues", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(computeBackoffDelay(JOB_REQUEUE, 0)).toBeGreaterThanOrEqual(60_000);
    expect(computeBackoffDelay(JOB_REQUEUE, 0)).toBeLessThan(120_000);
    expect(computeBackoffDelay(JOB_REQUEUE, 20)).toBeLessThanOrEqual(900_000);
  });
});
