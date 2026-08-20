import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The gate and the pass-through, nothing else.
 *
 * The 200 cases drive the REAL service through its injected reads
 * (`setTrailSupplyReportDepsForTests`), because
 * `scripts/check-test-boundaries.mjs` forbids `vi.mock` of `@/lib/services/*`
 * and `@/lib/supabase/*`. The report's own behaviour is asserted in
 * `src/lib/services/__tests__/trail-supply-report.test.ts`; the authorization
 * logic, including the blank-secret hardening, in
 * `src/lib/security/machine-caller.test.ts`.
 */
import {
  setTrailSupplyReportDepsForTests,
  type TrailSupplyReportDeps,
} from "@/lib/services/trail-supply-report";

import { GET } from "./route";

const url = "https://formoria.com/api/cron/trail-supply";
const secret = "mch_2026_08_7f4c3b29a1e6d8f0c2b5a9e4";

function authorizedRequest(): Request {
  return new Request(url, {
    method: "GET",
    headers: { "x-origin-verify": secret },
  });
}

function noSelections(): TrailSupplyReportDeps["selectionsClient"] {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => Promise.resolve({ data: [], error: null }),
  };

  return () =>
    ({ from: () => chain }) as unknown as ReturnType<
      TrailSupplyReportDeps["selectionsClient"]
    >;
}

describe("GET /api/cron/trail-supply", () => {
  afterEach(() => {
    setTrailSupplyReportDepsForTests(null);
    vi.unstubAllEnvs();
  });

  it("rejects an unauthorized caller", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await GET(
      new Request(url, {
        method: "GET",
        headers: {
          "x-origin-verify": "mch_2026_08_1a6e9c4d8b2f7a0e5c3d1b9f",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the summary for an authorized caller", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);
    setTrailSupplyReportDepsForTests({
      readTrails: async () => ({
        ok: true,
        trails: [
          {
            slug: "small-space-reading-corner",
            frontmatter: {
              draft: false,
              sections: [{ key: "first", title: "先讓光進來" }],
            },
          },
        ],
      }),
      readTrailPlacements: async () => [{ sectionKey: "first" }],
      selectionsClient: noSelections(),
    });

    const response = await GET(authorizedRequest());

    expect(response.status).toBe(200);
    // This is the only GET under /api/cron/, and a GET is cacheable by
    // intermediaries where the POST siblings are not. A cached supply report is
    // a stale one presented as tonight's.
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("x-origin-verify");
    expect(await response.json()).toEqual({
      readUnavailable: false,
      trailsObserved: 1,
      selectionsObserved: 0,
      emptySections: [],
      orphanedSelections: [],
    });
  });

  // Dormancy is the expected production state, not a failure: a 5xx here would
  // page someone nightly for a system working as designed.
  it("surfaces read unavailable rather than failing", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);
    setTrailSupplyReportDepsForTests({
      readTrails: async () => ({ ok: false }),
    });

    const response = await GET(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      readUnavailable: true,
      trailsObserved: 0,
      selectionsObserved: 0,
      emptySections: [],
      orphanedSelections: [],
    });
  });
});
