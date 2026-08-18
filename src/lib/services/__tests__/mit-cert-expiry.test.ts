import { describe, expect, it } from "vitest";
import { isMitCertUnexpired } from "../mit-verification";

/**
 * The expiry guard in `verifyMitByCert` is the only thing standing between an
 * expired government certificate and a public 台灣製 trust label, so it is
 * tested against the format the registry actually stores: `產品效期` verbatim,
 * `yyyymmdd`, all 245,135 rows of it.
 */

const NOW = new Date("2026-08-18T00:00:00Z");

describe("isMitCertUnexpired", () => {
  it("rejects an expired certificate", () => {
    // The regression: `new Date('20120127')` is an Invalid Date, so the old
    // inline `!isNaN(...) &&` guard skipped every row it existed to catch.
    expect(isMitCertUnexpired("20120127", NOW)).toBe(false);
    expect(isMitCertUnexpired("20260817", NOW)).toBe(false);
  });

  it("accepts a live certificate", () => {
    // rafac's real cert, 01700577-00001 in 017.csv — valid until 2027-05-15.
    expect(isMitCertUnexpired("20270515", NOW)).toBe(true);
  });

  it("keeps a certificate through the whole of its expiry date", () => {
    expect(isMitCertUnexpired("20260818", NOW)).toBe(true);
    expect(isMitCertUnexpired("20260818", new Date("2026-08-18T23:59:59Z"))).toBe(true);
    expect(isMitCertUnexpired("20260818", new Date("2026-08-19T00:00:00Z"))).toBe(false);
  });

  it("refuses a value it cannot read", () => {
    // A trust label, so an unreadable expiry is not evidence of a live cert.
    for (const value of ["", "  ", "2027-05-15", "202705", "not-a-date", "2027051X"]) {
      expect(isMitCertUnexpired(value, NOW)).toBe(false);
    }
  });

  it("tolerates the surrounding whitespace a CSV cell can carry", () => {
    expect(isMitCertUnexpired(" 20270515 ", NOW)).toBe(true);
  });
});
