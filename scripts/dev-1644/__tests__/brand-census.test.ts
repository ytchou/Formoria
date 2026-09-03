/**
 * Pure logic for the cohort before/after census.
 * No Supabase client — only the field statistics, the diff, and the guard that
 * refuses to point the census at production.
 */
import { describe, expect, it } from "vitest";

import {
  type CensusFile,
  type CensusRow,
  assertCensusTarget,
  countGallery,
  diffRow,
  emptyCensusRow,
  renderCensusDiff,
  summarizeProductRows,
  textStat,
} from "../brand-census";

const STAGING_URL = "https://ttkkyvgvcamfoezsetvf.supabase.co";
const PRODUCTION_URL = "https://xkcayngbttpxyibgzern.supabase.co";

// ---------------------------------------------------------------------------
// Target guard — staging by default, production only when asked twice
// ---------------------------------------------------------------------------

describe("assertCensusTarget", () => {
  it("allows the staging project without a confirmation", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: STAGING_URL,
        target: "staging",
        confirmed: false,
      }),
    ).not.toThrow();
  });

  it("refuses the production project even when --target production is passed alone", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "production",
        confirmed: false,
      }),
    ).toThrow(/--confirm/);
  });

  it("refuses a production URL that arrived under a staging target", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "staging",
        confirmed: true,
      }),
    ).toThrow(/production/);
  });

  it("allows production only with both --target production and --confirm", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "production",
        confirmed: true,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-field statistics
// ---------------------------------------------------------------------------

describe("textStat", () => {
  it("reports zero length and zero hits for a missing field", () => {
    expect(textStat(null, "zh")).toEqual({ length: 0, aiArtifactHits: 0 });
  });

  it("counts characters and AI artifact hits", () => {
    const stat = textStat("A pioneering brand with unparalleled craft.", "en");
    expect(stat.length).toBe(43);
    expect(stat.aiArtifactHits).toBe(2);
  });

  it("reports zero hits for prose the detector accepts", () => {
    expect(textStat("A leather workshop in Tainan, open since 2014.", "en").aiArtifactHits).toBe(0);
  });
});

describe("countGallery", () => {
  it("counts the gallery slots only — sort_order 1 through 9", () => {
    expect(
      countGallery([
        { sort_order: 0 },
        { sort_order: 1 },
        { sort_order: 9 },
        { sort_order: 10 },
      ]),
    ).toBe(2);
  });
});

describe("summarizeProductRows", () => {
  it("counts visible products and the three quality signals", () => {
    expect(
      summarizeProductRows([
        {
          visible: true,
          link_state: "ok",
          link_checked_at: "2026-09-01T00:00:00Z",
          made_in_taiwan_confirmed: true,
          image_url: "https://cdn/x.jpg",
        },
        {
          visible: true,
          link_state: "unchecked",
          link_checked_at: null,
          made_in_taiwan_confirmed: false,
          image_url: null,
        },
        {
          visible: false,
          link_state: "ok",
          link_checked_at: "2026-09-01T00:00:00Z",
          made_in_taiwan_confirmed: true,
          image_url: "https://cdn/y.jpg",
        },
      ]),
    ).toEqual({
      visible: 2,
      linkChecked: 1,
      mitConfirmed: 1,
      withImage: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function rowWith(overrides: Partial<CensusRow>): CensusRow {
  return { ...emptyCensusRow("alpha"), ...overrides };
}

describe("diffRow", () => {
  it("calls a count that went up an improvement and one that went down a regression", () => {
    const diffs = diffRow(
      rowWith({ active_image_count: 0, stockists_count: 3 }),
      rowWith({ active_image_count: 6, stockists_count: 1 }),
    );

    const byField = new Map(diffs.map((d) => [d.field, d]));
    expect(byField.get("active_image_count")?.direction).toBe("improved");
    expect(byField.get("stockists_count")?.direction).toBe("regressed");
  });

  it("inverts the direction for AI artifact hits — fewer is better", () => {
    const diffs = diffRow(
      rowWith({ description: { length: 200, aiArtifactHits: 3 } }),
      rowWith({ description: { length: 200, aiArtifactHits: 0 } }),
    );

    const byField = new Map(diffs.map((d) => [d.field, d]));
    expect(byField.get("description.ai_artifact_hits")?.direction).toBe("improved");
    expect(byField.get("description.length")?.direction).toBe("unchanged");
  });

  it("treats filling an empty link as an improvement and clearing it as a regression", () => {
    const filled = diffRow(
      rowWith({ purchase_website: null }),
      rowWith({ purchase_website: "https://alpha.com" }),
    ).find((d) => d.field === "purchase_website");
    expect(filled?.direction).toBe("improved");

    const cleared = diffRow(
      rowWith({ purchase_website: "https://alpha.com" }),
      rowWith({ purchase_website: null }),
    ).find((d) => d.field === "purchase_website");
    expect(cleared?.direction).toBe("regressed");
  });

  it("calls a swapped link changed, not improved — a different value is not a better one", () => {
    const swapped = diffRow(
      rowWith({ purchase_website: "https://old.example" }),
      rowWith({ purchase_website: "https://new.example" }),
    ).find((d) => d.field === "purchase_website");

    expect(swapped?.direction).toBe("changed");
    expect(swapped?.before).toBe("https://old.example");
    expect(swapped?.after).toBe("https://new.example");
  });

  it("marks every field unchanged for an identical row", () => {
    const row = rowWith({ active_image_count: 4 });
    expect(diffRow(row, row).every((d) => d.direction === "unchanged")).toBe(true);
  });
});

describe("renderCensusDiff", () => {
  const before: CensusFile = {
    cohort: "dev-1644-routing-pilot",
    capturedAt: "2026-09-03T00:00:00Z",
    rows: [rowWith({ slug: "alpha", active_image_count: 0 })],
  };
  const after: CensusFile = {
    cohort: "dev-1644-routing-pilot",
    capturedAt: "2026-09-03T02:00:00Z",
    rows: [rowWith({ slug: "alpha", active_image_count: 5 })],
  };

  it("prints one section per brand with before, after and the change marker", () => {
    const md = renderCensusDiff(before, after);

    expect(md).toContain("## alpha");
    expect(md).toContain("| active_image_count | 0 | 5 | improved |");
  });

  it("prints a totals line counting improved, regressed, changed and unchanged fields", () => {
    const md = renderCensusDiff(before, after);

    expect(md).toMatch(/improved 1/);
    expect(md).toMatch(/regressed 0/);
  });

  it("names a brand that only one side of the diff holds instead of dropping it", () => {
    const md = renderCensusDiff(before, {
      ...after,
      rows: [...after.rows, rowWith({ slug: "beta" })],
    });

    expect(md).toContain("beta");
    expect(md).toContain("missing");
  });
});
