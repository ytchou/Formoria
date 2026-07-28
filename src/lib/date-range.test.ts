import { describe, expect, it } from "vitest";
import {
  dateRangeForPastDays,
  isoDateInTimeZone,
  isDateInRange,
} from "./date-range";

describe("shared date ranges", () => {
  it("uses inclusive calendar-day boundaries for analytics and submission filters", () => {
    // 2026-07-28 12:00 in Asia/Taipei
    const range = dateRangeForPastDays(7, new Date("2026-07-28T04:00:00.000Z"));

    expect(range).toEqual({ start: "2026-07-21", end: "2026-07-27" });
    expect(isDateInRange("2026-07-21", range)).toBe(true);
    expect(isDateInRange("2026-07-27", range)).toBe(true);
    expect(isDateInRange("2026-07-20", range)).toBe(false);
    expect(isDateInRange("2026-07-28", range)).toBe(false);
    expect(
      isoDateInTimeZone("2026-07-17T16:00:00.000Z", "Asia/Taipei"),
    ).toBe("2026-07-18");
  });

  it("resolves the range in Asia/Taipei across the UTC day boundary", () => {
    // 16:00–24:00 UTC is already the next calendar day in Taipei (UTC+8).
    // Both instants must yield the same Taipei-based range regardless of the
    // runtime timezone, otherwise server and client hydration diverge.
    const beforeMidnightTaipei = dateRangeForPastDays(
      30,
      new Date("2026-07-27T15:59:59.000Z"),
    );
    const afterMidnightTaipei = dateRangeForPastDays(
      30,
      new Date("2026-07-27T16:00:00.000Z"),
    );

    expect(beforeMidnightTaipei).toEqual({
      start: "2026-06-27",
      end: "2026-07-26",
    });
    expect(afterMidnightTaipei).toEqual({
      start: "2026-06-28",
      end: "2026-07-27",
    });
  });
});
