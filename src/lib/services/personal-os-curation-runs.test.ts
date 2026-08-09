import { describe, expect, it } from "vitest";
import {
  normalizePersonalOsCurationRunsLimit,
  PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT,
  PERSONAL_OS_CURATION_RUNS_MAX_LIMIT,
} from "./personal-os-curation-runs";

describe("Personal OS curation run projection", () => {
  // Bug caught: an internal caller could request an unbounded job page or a zero-sized page.
  it("caps the service limit to the safe 1..50 range", () => {
    expect(normalizePersonalOsCurationRunsLimit()).toBe(PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT);
    expect(normalizePersonalOsCurationRunsLimit(0)).toBe(1);
    expect(normalizePersonalOsCurationRunsLimit(50.9)).toBe(PERSONAL_OS_CURATION_RUNS_MAX_LIMIT);
    expect(normalizePersonalOsCurationRunsLimit(500)).toBe(PERSONAL_OS_CURATION_RUNS_MAX_LIMIT);
    expect(normalizePersonalOsCurationRunsLimit(Number.NaN)).toBe(PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT);
  });
});
