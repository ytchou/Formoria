import { describe, it, expect } from "vitest";
import {
  DETECTOR_NAMES,
  DETECTOR_SOURCE,
  DETECTOR_SCHEDULE,
  HEALTH_SOURCES,
  WEEKLY_RUN_WEEKDAY,
  isDueOn,
  type HealthSource,
} from "../health-detectors";

describe("health detector registry", () => {
  it("every detector name maps to exactly one source", () => {
    const sourceKeys = new Set(Object.keys(DETECTOR_SOURCE));
    const nameSet = new Set<string>(DETECTOR_NAMES);

    // DETECTOR_SOURCE has a key for every entry of DETECTOR_NAMES
    for (const name of DETECTOR_NAMES) {
      expect(sourceKeys.has(name), `missing source for detector '${name}'`).toBe(true);
    }

    // No extra keys in DETECTOR_SOURCE beyond DETECTOR_NAMES
    for (const key of sourceKeys) {
      expect(nameSet.has(key), `extra source key '${key}' not in DETECTOR_NAMES`).toBe(true);
    }

    expect(sourceKeys.size).toBe(DETECTOR_NAMES.length);
  });

  it("carried-over sources keep their exact names", () => {
    // These source names are persisted in health_fix_queue rows. Renaming
    // them strands active ledger rows.
    const carriedOver: HealthSource[] = ["link", "directory", "sentry", "quality", "cron"];
    for (const source of carriedOver) {
      expect(
        HEALTH_SOURCES.includes(source),
        `carried-over source '${source}' missing from HEALTH_SOURCES`,
      ).toBe(true);
    }
  });

  it("weekly detectors are exactly the links-weekly source", () => {
    const weeklyDetectors = DETECTOR_NAMES.filter(
      (name) => DETECTOR_SCHEDULE[name] === "weekly",
    );
    const linksWeeklyDetectors = DETECTOR_NAMES.filter(
      (name) => DETECTOR_SOURCE[name] === "links-weekly",
    );

    // Every weekly-scheduled detector has source 'links-weekly'
    for (const d of weeklyDetectors) {
      expect(
        DETECTOR_SOURCE[d],
        `weekly detector '${d}' should have source 'links-weekly'`,
      ).toBe("links-weekly");
    }

    // Every links-weekly source detector is weekly-scheduled
    for (const d of linksWeeklyDetectors) {
      expect(
        DETECTOR_SCHEDULE[d],
        `links-weekly detector '${d}' should be weekly`,
      ).toBe("weekly");
    }

    expect(new Set(weeklyDetectors)).toEqual(new Set(linksWeeklyDetectors));
  });

  it("isDueOn returns weekly detectors only on the configured weekday", () => {
    // WEEKLY_RUN_WEEKDAY is a 0-6 (Sunday=0) day-of-week.
    // Build a Taipei-timezone date string for that weekday and another day.

    // Find a date in 2026 that falls on WEEKLY_RUN_WEEKDAY
    const baseDate = new Date("2026-01-04T12:00:00+08:00"); // Sunday 2026-01-04
    const weeklyDate = new Date(baseDate);
    weeklyDate.setDate(baseDate.getDate() + WEEKLY_RUN_WEEKDAY);

    // A non-weekly day: shift by 1 (mod 7 guarantees different weekday)
    const otherDate = new Date(baseDate);
    otherDate.setDate(baseDate.getDate() + ((WEEKLY_RUN_WEEKDAY + 1) % 7));

    const weeklyDateStr = weeklyDate.toISOString().slice(0, 10);
    const otherDateStr = otherDate.toISOString().slice(0, 10);

    const dueOnWeekly = isDueOn(weeklyDateStr);
    const dueOnOther = isDueOn(otherDateStr);

    // All nightly detectors should be in both
    const nightlyDetectors = DETECTOR_NAMES.filter(
      (name) => DETECTOR_SCHEDULE[name] === "nightly",
    );
    for (const d of nightlyDetectors) {
      expect(dueOnWeekly, `nightly detector '${d}' missing on weekly day`).toContain(d);
      expect(dueOnOther, `nightly detector '${d}' missing on other day`).toContain(d);
    }

    // Weekly detectors should be present only on the weekly day
    const weeklyDetectors = DETECTOR_NAMES.filter(
      (name) => DETECTOR_SCHEDULE[name] === "weekly",
    );
    for (const d of weeklyDetectors) {
      expect(dueOnWeekly, `weekly detector '${d}' missing on weekly day`).toContain(d);
      expect(dueOnOther, `weekly detector '${d}' should NOT be due on other day`).not.toContain(d);
    }
  });
});
