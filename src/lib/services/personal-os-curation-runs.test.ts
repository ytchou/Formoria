import { describe, expect, it } from "vitest";
import {
  normalizePersonalOsCurationRunsLimit,
  normalizePersonalOsCurationRunsWindow,
  PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT,
  PERSONAL_OS_CURATION_RUNS_MAX_LIMIT,
} from "./personal-os-curation-runs";

describe("Personal OS curation run projection", () => {
  // Bug caught: an internal caller could request an unbounded job page or a zero-sized page.
  it("caps the service limit to the safe 1..50 range", () => {
    expect(normalizePersonalOsCurationRunsLimit()).toBe(
      PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT,
    );
    expect(normalizePersonalOsCurationRunsLimit(0)).toBe(1);
    expect(normalizePersonalOsCurationRunsLimit(50.9)).toBe(
      PERSONAL_OS_CURATION_RUNS_MAX_LIMIT,
    );
    expect(normalizePersonalOsCurationRunsLimit(500)).toBe(
      PERSONAL_OS_CURATION_RUNS_MAX_LIMIT,
    );
    expect(normalizePersonalOsCurationRunsLimit(Number.NaN)).toBe(
      PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT,
    );
  });

  it("normalizes a complete inclusive-exclusive run window", () => {
    expect(
      normalizePersonalOsCurationRunsWindow(
        "2026-08-09T16:00:00Z",
        "2026-08-10T16:00:00Z",
      ),
    ).toEqual({
      start: "2026-08-09T16:00:00.000Z",
      end: "2026-08-10T16:00:00.000Z",
    });
    expect(normalizePersonalOsCurationRunsWindow(null, null)).toBeUndefined();
    expect(() =>
      normalizePersonalOsCurationRunsWindow("2026-08-09T16:00:00Z", null),
    ).toThrow("start and end must be provided together");
    expect(() =>
      normalizePersonalOsCurationRunsWindow("invalid", "2026-08-10T16:00:00Z"),
    ).toThrow("valid timestamps");
    expect(() =>
      normalizePersonalOsCurationRunsWindow(
        "2026-08-10T16:00:00Z",
        "2026-08-09T16:00:00Z",
      ),
    ).toThrow("start must be before end");
  });
});
