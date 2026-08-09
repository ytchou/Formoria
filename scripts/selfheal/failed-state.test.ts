import { describe, expect, it } from "vitest";
import { nextTargetedAttempt, parseModelUsage, validateCollectedIds } from "./failed-state";

describe("bounded failed-test state", () => {
  it("preserves an exact shrinking set from four failures to zero", () => {
    const collected = ["a", "b", "c", "d"];
    expect(validateCollectedIds({ status: "failed", failedTests: collected }, collected)).toBe(4);
    expect(validateCollectedIds({ status: "failed", failedTests: ["c", "d"] }, collected)).toBe(2);
    expect(validateCollectedIds({ status: "passed", failedTests: [] }, collected)).toBe(0);
  });

  it("fails closed when an edited test ID can no longer be collected", () => {
    expect(() => validateCollectedIds({ status: "failed", failedTests: ["renamed"] }, ["current"]))
      .toThrow("no longer collectible");
  });

  it("caps targeted verification at eight calls", () => {
    expect(nextTargetedAttempt(7)).toBe(8);
    expect(() => nextTargetedAttempt(8)).toThrow("limit reached");
  });

  it("keeps missing Claude usage additive and non-blocking", () => {
    expect(parseModelUsage(null)).toEqual({ cost_usd: null, turns: null, duration_ms: null });
    expect(parseModelUsage({ total_cost_usd: 3.5, num_turns: 42, duration_ms: 9000 }))
      .toEqual({ cost_usd: 3.5, turns: 42, duration_ms: 9000 });
    expect(parseModelUsage([{ type: "assistant" }, { type: "result", total_cost_usd: 2, num_turns: 9, duration_ms: 4000 }]))
      .toEqual({ cost_usd: 2, turns: 9, duration_ms: 4000 });
  });
});
