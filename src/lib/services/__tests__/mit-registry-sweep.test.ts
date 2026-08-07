import { describe, expect, it } from "vitest";
import {
  MIN_SWEEP_COVERAGE_RATIO,
  shouldSweepStaleRecords,
} from "../mit-registry";

/**
 * The sweep guard is tested as a pure decision helper rather than by driving
 * `syncMitRegistry`, which needs the live upstream ZIP and a Supabase client.
 * The helper is the only branch guarding the delete — the sync does nothing
 * else with the decision.
 */

describe("shouldSweepStaleRecords", () => {
  it("sweeps on an empty table so the first populating sync is unblocked", () => {
    expect(shouldSweepStaleRecords(0, 0)).toBe(true);
    expect(shouldSweepStaleRecords(29_452, 0)).toBe(true);
  });

  it("sweeps a full weekly republish", () => {
    expect(shouldSweepStaleRecords(29_452, 29_400)).toBe(true);
  });

  it("sweeps a plausible net shrink", () => {
    expect(shouldSweepStaleRecords(28_000, 29_452)).toBe(true);
  });

  it("refuses to sweep a truncated payload", () => {
    expect(shouldSweepStaleRecords(5_000, 29_452)).toBe(false);
  });

  it("refuses to sweep an empty payload against a populated table", () => {
    expect(shouldSweepStaleRecords(0, 29_452)).toBe(false);
  });

  it("treats the coverage ratio as the inclusive floor", () => {
    const existing = 1_000;
    const floor = existing * MIN_SWEEP_COVERAGE_RATIO;
    expect(shouldSweepStaleRecords(floor, existing)).toBe(true);
    expect(shouldSweepStaleRecords(floor - 1, existing)).toBe(false);
  });
});
