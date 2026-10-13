import { describe, expect, it } from "vitest";
import { isoDateInTimeZone, isDateInRange } from "./date-range";

describe("shared date ranges", () => {
  it("includes both calendar-day boundaries in submission filters", () => {
    const range = { start: "2026-07-21", end: "2026-07-27" };
    expect(isDateInRange("2026-07-21", range)).toBe(true);
    expect(isDateInRange("2026-07-27", range)).toBe(true);
    expect(isDateInRange("2026-07-20", range)).toBe(false);
    expect(isDateInRange("2026-07-28", range)).toBe(false);
  });

  it("resolves the Taipei calendar day across the UTC 16:00 boundary", () => {
    expect(isoDateInTimeZone("2026-07-27T15:59:59.000Z", "Asia/Taipei")).toBe(
      "2026-07-27",
    );
    expect(isoDateInTimeZone("2026-07-27T16:00:00.000Z", "Asia/Taipei")).toBe(
      "2026-07-28",
    );
  });
});
