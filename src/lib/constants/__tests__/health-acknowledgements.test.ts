import { describe, expect, it } from "vitest";
import {
  HEALTH_ACKNOWLEDGEMENTS,
  isAcknowledged,
  type HealthAcknowledgement,
} from "../health-acknowledgements";

const LIST: readonly HealthAcknowledgement[] = [
  {
    match: "directory:trail-empty-section:",
    reason: "Prefix entry",
    ticket: "DEV-1",
    until: "2026-10-31",
  },
  {
    match: "cron:stale-job:link-health-check",
    reason: "Exact entry",
    ticket: "DEV-2",
    until: "2026-10-31",
  },
];

describe("isAcknowledged", () => {
  it("matches an exact fingerprint", () => {
    expect(
      isAcknowledged("cron:stale-job:link-health-check", "2026-10-01", LIST)?.ticket,
    ).toBe("DEV-2");
  });

  it("does not treat an entry without a trailing colon as a prefix", () => {
    expect(
      isAcknowledged("cron:stale-job:link-health-check-2", "2026-10-01", LIST),
    ).toBeUndefined();
  });

  it("matches a prefix when the entry ends with a colon", () => {
    expect(
      isAcknowledged("directory:trail-empty-section:gift-for-dad", "2026-10-01", LIST)?.ticket,
    ).toBe("DEV-1");
    expect(
      isAcknowledged("directory:trail-empty-sectionx", "2026-10-01", LIST),
    ).toBeUndefined();
  });

  it("matches through the until day inclusive and expires the next day", () => {
    const fingerprint = "directory:trail-empty-section:gift-for-dad";
    expect(isAcknowledged(fingerprint, "2026-10-31", LIST)).toBeDefined();
    expect(isAcknowledged(fingerprint, "2026-11-01", LIST)).toBeUndefined();
  });

  it("scopes the DEV-1903 release-window entries to the re-picked trails", () => {
    const today = "2026-10-01";
    expect(
      isAcknowledged("directory:trail-orphaned-selection:desk-setup:lighting", today),
    ).toBeDefined();
    expect(
      isAcknowledged("directory:trail-orphaned-selection:gift-for-dad:intro", today),
    ).toBeUndefined();
    expect(
      isAcknowledged("directory:trail-orphaned-note:small-space-reading-corner:light", today),
    ).toBeDefined();
    expect(
      isAcknowledged("directory:trail-unnoted-placement:desk-setup:lighting", today),
    ).toBeUndefined();
    expect(
      isAcknowledged("directory:trail-orphaned-selection:desk-setup:lighting", "2026-10-16"),
    ).toBeUndefined();
  });

  it("every shipped entry names a ticket and an ISO expiry date", () => {
    for (const entry of HEALTH_ACKNOWLEDGEMENTS) {
      expect(entry.ticket).toMatch(/^[A-Z][A-Z0-9]*-\d+$/);
      expect(entry.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});
